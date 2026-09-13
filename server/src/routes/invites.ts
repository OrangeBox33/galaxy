// Приглашения. Приглашение — это «тусклая точка» на небе, видная ТОЛЬКО
// пригласившему (раздел 6).
import { Router } from 'express';
import { randomBytes } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { MAX_PENDING_INVITES } from '../../../shared/config.js';
import { db } from '../db.js';
import { env } from '../env.js';
import { conflict, notFound } from '../lib/errors.js';
import { rateLimit } from '../lib/rateLimit.js';
import { str, optional, body as reqBody } from '../lib/validate.js';
import { displayName } from '../lib/names.js';
import { normalizePair } from '../lib/pair.js';
import { markLayoutDirty } from '../layout/state.js';
import { enqueue, escapeHtml } from '../bot/outbox.js';
import { requireActiveUser, requireSession } from '../auth/middleware.js';

export const SHARE_TEXT =
	'Привет! Я собираю карту своих друзей и знакомых — она выглядит как звёздное небо, ' +
	'где каждый человек звезда, а знакомства — линии между ними. ' +
	'Открой ссылку, и рядом с моей звездой загорится твоя.';

// startapp (а не start) открывает Mini App сразу, минуя чат с ботом.
export function inviteUrl(token: string): string {
	return `https://t.me/${env.botUsername}?startapp=${token}`;
}

function newToken(): string {
	return randomBytes(16).toString('base64url');
}

// Приём приглашения при входе (раздел 6.3). Вызывается внутри той же транзакции,
// что и создание пользователя.
export async function acceptInvite(
	tx: Prisma.TransactionClient,
	userId: bigint,
	token: string,
): Promise<void> {
	const invite = await tx.invite.findUnique({ where: { token } });
	// Нет приглашения или оно уже использовано — просто логиним, ничего не делая.
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
				data: { token: newToken(), inviterId: userId, label },
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
