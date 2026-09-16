// Админка: права проверяются на сервере, изменения пишутся в AdminAudit.
import { Router } from 'express';
import type { Prisma } from '@prisma/client';
import { AGE_MAX, AGE_MIN, GENDERS } from '../../../shared/config.js';
import { db } from '../db.js';
import { conflict, notFound } from '../lib/errors.js';
import { cleanName, displayName } from '../lib/names.js';
import { normalizePair } from '../lib/pair.js';
import { bigint, bool, has, int, oneOf, optional, str, body as reqBody } from '../lib/validate.js';
import { requireAdmin, requireSession } from '../auth/middleware.js';
import { markLayoutDirty } from '../layout/state.js';
import { isRecomputing, recomputeLayout } from '../layout/runner.js';

// Telegram id всегда положительные, поэтому отрицательные свободны под тестовых.
const TEST_ID_START = -1000000n;

async function nextTestId(tx: Prisma.TransactionClient): Promise<bigint> {
	const lowest = await tx.user.findFirst({
		where: { id: { lt: 0n } },
		orderBy: { id: 'asc' },
		select: { id: true },
	});
	return lowest === null ? TEST_ID_START : lowest.id - 1n;
}

async function audit(
	adminId: bigint,
	action: string,
	targetId: string,
	details?: Prisma.InputJsonValue,
): Promise<void> {
	await db.adminAudit.create({ data: { adminId, action, targetId, details } });
}

export function adminRouter(): Router {
	const router = Router();
	router.use(requireSession, requireAdmin);

	router.get('/users', async (_req, res, next) => {
		try {
			const users = await db.user.findMany({
				orderBy: { id: 'asc' },
				include: {
					_count: { select: { linksA: true, linksB: true, invitesSent: true } },
				},
			});

			const accepted = await db.invite.groupBy({
				by: ['inviterId'],
				where: { status: 'ACCEPTED' },
				_count: { _all: true },
			});
			const acceptedByUser = new Map(
				accepted.map((row) => [row.inviterId.toString(), row._count._all]),
			);

			res.json(
				users.map((user) => ({
					id: user.id.toString(),
					name: displayName(user),
					customName: user.customName,
					username: user.telegramUsername,
					age: user.age,
					gender: user.gender,
					avatar: user.avatarFile,
					isTest: user.isTest,
					isBlocked: user.isBlocked,
					nameLockedByAdmin: user.nameLockedByAdmin,
					links: user._count.linksA + user._count.linksB,
					invitesSent: user._count.invitesSent,
					invitesAccepted: acceptedByUser.get(user.id.toString()) ?? 0,
					createdAt: user.createdAt.toISOString(),
					lastSeenAt: user.lastSeenAt.toISOString(),
				})),
			);
		} catch (err) {
			next(err);
		}
	});

	router.get('/users/:id/links', async (req, res, next) => {
		try {
			const id = bigint(req.params.id, 'id');
			const links = await db.link.findMany({
				where: { OR: [{ aId: id }, { bId: id }] },
				include: { a: true, b: true },
			});
			res.json(
				links.map((link) => {
					const other = link.aId === id ? link.b : link.a;
					return {
						id: link.id,
						otherId: other.id.toString(),
						otherName: displayName(other),
						createdAt: link.createdAt.toISOString(),
					};
				}),
			);
		} catch (err) {
			next(err);
		}
	});

	router.post('/users', async (req, res, next) => {
		try {
			const parsed = reqBody(req);
			const name = cleanName(str(parsed.name, 'name', { max: 64 }), 'name');
			const age = optional(parsed.age, () =>
				int(parsed.age, 'age', { min: AGE_MIN, max: AGE_MAX }),
			);
			const gender = has(parsed, 'gender')
				? oneOf(parsed.gender, 'gender', GENDERS)
				: 'UNSPECIFIED';

			const user = await db.$transaction(async (tx) => {
				const id = await nextTestId(tx);
				const created = await tx.user.create({
					data: { id, customName: name, age, gender, isTest: true },
				});
				await markLayoutDirty(tx);
				return created;
			});

			await audit(req.userId!, 'create_test', user.id.toString(), { name });
			res.status(201).json({ id: user.id.toString(), name: displayName(user) });
		} catch (err) {
			next(err);
		}
	});

	router.patch('/users/:id', async (req, res, next) => {
		try {
			const id = bigint(req.params.id, 'id');
			const parsed = reqBody(req);
			const data: Prisma.UserUpdateInput = {};
			const changes: Record<string, unknown> = {};

			if (has(parsed, 'displayName')) {
				const name = cleanName(str(parsed.displayName, 'displayName', { max: 64 }));
				data.customName = name;
				data.nameLockedByAdmin = true;
				changes.displayName = name;
			}
			if (has(parsed, 'age')) {
				data.age = optional(parsed.age, () =>
					int(parsed.age, 'age', { min: AGE_MIN, max: AGE_MAX }),
				);
				changes.age = data.age;
			}
			if (has(parsed, 'gender')) {
				data.gender = oneOf(parsed.gender, 'gender', GENDERS);
				changes.gender = data.gender;
			}
			if (has(parsed, 'isBlocked')) {
				data.isBlocked = bool(parsed.isBlocked, 'isBlocked');
				changes.isBlocked = data.isBlocked;
			}

			const user = await db.user
				.update({ where: { id }, data })
				.catch(() => Promise.reject(notFound('Пользователь не найден')));

			await audit(req.userId!, 'update_user', id.toString(), changes as Prisma.InputJsonValue);
			res.json({ id: user.id.toString(), name: displayName(user) });
		} catch (err) {
			next(err);
		}
	});

	router.delete('/users/:id', async (req, res, next) => {
		try {
			const id = bigint(req.params.id, 'id');
			await db.user
				.delete({ where: { id } })
				.catch(() => Promise.reject(notFound('Пользователь не найден')));
			await markLayoutDirty();
			await audit(req.userId!, 'delete_user', id.toString());
			res.status(204).end();
		} catch (err) {
			next(err);
		}
	});

	router.post('/links', async (req, res, next) => {
		try {
			const parsed = reqBody(req);
			const aRaw = bigint(parsed.aId, 'aId');
			const bRaw = bigint(parsed.bId, 'bId');
			if (aRaw === bRaw) throw conflict('self_link', 'Нельзя связать пользователя с собой');

			const [aId, bId] = normalizePair(aRaw, bRaw);
			const both = await db.user.count({ where: { id: { in: [aId, bId] } } });
			if (both !== 2) throw notFound('Пользователь не найден');
			if (await db.link.findUnique({ where: { aId_bId: { aId, bId } } })) {
				throw conflict('link_exists', 'Связь уже есть');
			}

			await db.$transaction(async (tx) => {
				// createdById = null: связь создана админом, а не человеком.
				await tx.link.create({ data: { aId, bId } });
				await tx.user.update({ where: { id: aId }, data: { degree: { increment: 1 } } });
				await tx.user.update({ where: { id: bId }, data: { degree: { increment: 1 } } });
				await markLayoutDirty(tx);
			});

			await audit(req.userId!, 'create_link', `${aId}-${bId}`);
			res.status(201).json({ ok: true });
		} catch (err) {
			next(err);
		}
	});

	router.delete('/links', async (req, res, next) => {
		try {
			const parsed = reqBody(req);
			const [aId, bId] = normalizePair(bigint(parsed.aId, 'aId'), bigint(parsed.bId, 'bId'));
			const link = await db.link.findUnique({ where: { aId_bId: { aId, bId } } });
			if (!link) throw notFound('Связи нет');

			await db.$transaction(async (tx) => {
				await tx.link.delete({ where: { id: link.id } });
				await tx.user.update({ where: { id: aId }, data: { degree: { decrement: 1 } } });
				await tx.user.update({ where: { id: bId }, data: { degree: { decrement: 1 } } });
				await markLayoutDirty(tx);
			});

			await audit(req.userId!, 'delete_link', `${aId}-${bId}`);
			res.status(204).end();
		} catch (err) {
			next(err);
		}
	});

	router.get('/invites', async (_req, res, next) => {
		try {
			const invites = await db.invite.findMany({
				orderBy: { createdAt: 'desc' },
				include: { inviter: true, acceptedBy: true },
			});
			res.json(
				invites.map((invite) => ({
					id: invite.id,
					label: invite.label,
					status: invite.status,
					inviterId: invite.inviterId.toString(),
					inviterName: displayName(invite.inviter),
					acceptedById: invite.acceptedById?.toString() ?? null,
					acceptedByName: invite.acceptedBy ? displayName(invite.acceptedBy) : null,
					createdAt: invite.createdAt.toISOString(),
					acceptedAt: invite.acceptedAt?.toISOString() ?? null,
				})),
			);
		} catch (err) {
			next(err);
		}
	});

	// full — с нуля, от подсолнуха: вытаскивает небо из слежавшейся раскладки;
	// warm — от сохранённых мест, но дольше: картинка меняется мягко.
	router.post('/layout/recompute', async (req, res, next) => {
		try {
			if (isRecomputing()) throw conflict('layout_busy', 'Пересчёт уже идёт');
			const parsed = reqBody(req);
			const mode = has(parsed, 'mode') ? oneOf(parsed.mode, 'mode', ['full', 'warm']) : 'full';
			const result = await recomputeLayout({
				full: mode === 'full',
				iterations: mode === 'warm' ? 'long' : undefined,
			});
			await audit(req.userId!, 'recompute_layout', String(result.version), { mode });
			res.json({ ...result, mode });
		} catch (err) {
			next(err);
		}
	});

	router.get('/audit', async (_req, res, next) => {
		try {
			const rows = await db.adminAudit.findMany({ orderBy: { createdAt: 'desc' }, take: 200 });
			res.json(
				rows.map((row) => ({
					id: row.id,
					adminId: row.adminId.toString(),
					action: row.action,
					targetId: row.targetId,
					details: row.details,
					createdAt: row.createdAt.toISOString(),
				})),
			);
		} catch (err) {
			next(err);
		}
	});

	return router;
}
