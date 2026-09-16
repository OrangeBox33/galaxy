// Вход по ссылке. Основной путь — постоянная личная ссылка (`User.inviteToken`):
// она не сгорает, и каждый пришедший по ней связывается с хозяином. Одноразовые
// приглашения оставлены под коробкой: роутер рабочий, но клиент их не создаёт.
import { Router } from 'express';
import type { Prisma } from '@prisma/client';
import { MAX_LINKS_PER_USER, MAX_PENDING_INVITES } from '../../../shared/config.js';
import { db } from '../db.js';
import { conflict, notFound } from '../lib/errors.js';
import { rateLimit } from '../lib/rateLimit.js';
import { str, optional, body as reqBody } from '../lib/validate.js';
import { displayName } from '../lib/names.js';
import { normalizePair } from '../lib/pair.js';
import {
	inviteUrl,
	newInviteToken,
	normalizeInviteToken,
	SHARE_TEXT,
} from '../lib/inviteLink.js';
import { markLayoutDirty } from '../layout/state.js';
import { enqueue, escapeHtml } from '../bot/outbox.js';
import { requireActiveUser, requireSession } from '../auth/middleware.js';

export { inviteUrl, SHARE_TEXT };

async function countLinks(tx: Prisma.TransactionClient, userId: bigint): Promise<number> {
	return tx.link.count({ where: { OR: [{ aId: userId }, { bId: userId }] } });
}

// Связь по чьей-то постоянной ссылке. Повторный приход того же человека
// ничего не ломает: связь уже есть, второй раз не создаём.
async function linkByPersonalToken(
	tx: Prisma.TransactionClient,
	hostId: bigint,
	userId: bigint,
): Promise<void> {
	if (hostId === userId) return;

	const host = await tx.user.findUnique({ where: { id: hostId } });
	if (!host || host.isBlocked) return;

	const [aId, bId] = normalizePair(hostId, userId);
	if (await tx.link.findUnique({ where: { aId_bId: { aId, bId } } })) return;

	// Предел связей — тот же, что у ручного «Связать»: ссылка не лазейка мимо него.
	if ((await countLinks(tx, hostId)) >= MAX_LINKS_PER_USER) return;
	if ((await countLinks(tx, userId)) >= MAX_LINKS_PER_USER) return;

	await tx.link.create({ data: { aId, bId, createdById: hostId } });
	await tx.user.update({ where: { id: aId }, data: { degree: { increment: 1 } } });
	await tx.user.update({ where: { id: bId }, data: { degree: { increment: 1 } } });

	const guest = await tx.user.findUnique({ where: { id: userId } });
	if (guest) {
		await enqueue(
			tx,
			hostId,
			'invite_accepted',
			`🌟 <b>${escapeHtml(displayName(guest))}</b> пришёл(ла) по твоей ссылке — ` +
				'рядом с твоей звездой загорелась новая.',
		);
	}

	await markLayoutDirty(tx);
}

// Вызывается внутри той же транзакции, что и создание пользователя.
export async function acceptInvite(
	tx: Prisma.TransactionClient,
	userId: bigint,
	token: string,
): Promise<void> {
	// Сначала постоянные ссылки: одноразовых новых больше не выдают,
	// но старые из чужих переписок обязаны работать и дальше.
	const host = await tx.user.findUnique({
		where: { inviteToken: normalizeInviteToken(token) },
	});
	if (host) return linkByPersonalToken(tx, host.id, userId);

	const invite = await tx.invite.findUnique({ where: { token } });
	if (!invite || invite.status !== 'PENDING') return;

	// Приглашение самому себе связи не создаёт: петля на карте бессмысленна.
	if (invite.inviterId === userId) {
		await tx.invite.update({ where: { id: invite.id }, data: { status: 'REVOKED' } });
		return;
	}

	const [aId, bId] = normalizePair(invite.inviterId, userId);
	const existing = await tx.link.findUnique({ where: { aId_bId: { aId, bId } } });

	if (!existing) {
		await tx.link.create({ data: { aId, bId, createdById: invite.inviterId } });
		await tx.user.update({ where: { id: aId }, data: { degree: { increment: 1 } } });
		await tx.user.update({ where: { id: bId }, data: { degree: { increment: 1 } } });
	}

	await tx.invite.update({
		where: { id: invite.id },
		data: { status: 'ACCEPTED', acceptedById: userId, acceptedAt: new Date() },
	});

	const acceptor = await tx.user.findUnique({ where: { id: userId } });
	if (acceptor) {
		await enqueue(
			tx,
			invite.inviterId,
			'invite_accepted',
			`🌟 <b>${escapeHtml(displayName(acceptor))}</b> принял(а) приглашение — ` +
				'рядом с твоей звездой загорелась новая.',
		);
	}

	await markLayoutDirty(tx);
}

export function invitesRouter(): Router {
	const router = Router();
	router.use(requireSession, requireActiveUser);

	router.post('/', rateLimit('invites', 10), async (req, res, next) => {
		try {
			const userId = req.userId!;
			const parsed = reqBody(req);
			const label = optional(parsed.label, () => str(parsed.label, 'label', { max: 64 }));

			const pending = await db.invite.count({
				where: { inviterId: userId, status: 'PENDING' },
			});
			if (pending >= MAX_PENDING_INVITES) {
				throw conflict('too_many_invites', 'Слишком много неиспользованных приглашений');
			}

			const invite = await db.invite.create({
				data: { token: newInviteToken(), inviterId: userId, label },
			});

			res.json({
				id: invite.id,
				token: invite.token,
				url: inviteUrl(invite.token),
				shareText: SHARE_TEXT,
			});
		} catch (err) {
			next(err);
		}
	});

	router.get('/', async (req, res, next) => {
		try {
			const invites = await db.invite.findMany({
				where: { inviterId: req.userId!, status: 'PENDING' },
				orderBy: { createdAt: 'desc' },
			});
			res.json(
				invites.map((invite) => ({
					id: invite.id,
					label: invite.label,
					url: inviteUrl(invite.token),
					createdAt: invite.createdAt.toISOString(),
				})),
			);
		} catch (err) {
			next(err);
		}
	});

	router.delete('/:id', async (req, res, next) => {
		try {
			const invite = await db.invite.findUnique({ where: { id: req.params.id } });
			if (!invite || invite.inviterId !== req.userId! || invite.status !== 'PENDING') {
				throw notFound('Приглашение не найдено');
			}
			await db.invite.update({ where: { id: invite.id }, data: { status: 'REVOKED' } });
			res.status(204).end();
		} catch (err) {
			next(err);
		}
	});

	return router;
}
