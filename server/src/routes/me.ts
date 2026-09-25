import { Router } from 'express';
import { AGE_MAX, AGE_MIN, GENDERS, STAR_COLORS } from '../../../shared/config.js';
import { placeNewStar } from '../../../shared/layout/index.js';
import { db } from '../db.js';
import { forbidden } from '../lib/errors.js';
import { cleanName } from '../lib/names.js';
import { rateLimit } from '../lib/rateLimit.js';
import { ensureInviteToken } from '../lib/inviteLink.js';
import { toProfile } from '../lib/views.js';
import { has, int, oneOf, optional, str, body as reqBody } from '../lib/validate.js';
import { clearSession } from '../auth/session.js';
import { requireActiveUser, requireSession } from '../auth/middleware.js';
import { markLayoutDirty } from '../layout/state.js';
import { recomputeLayout } from '../layout/runner.js';

// Пересчёт идёт в одном экземпляре: если он уже запущен, ждём и повторяем —
// тот, что застали, мог начаться до того, как мы записали свою точку.
async function settleLayout(): Promise<void> {
	for (let attempt = 0; attempt < 3; attempt += 1) {
		try {
			await recomputeLayout({ full: false });
			return;
		} catch {
			await new Promise((done) => setTimeout(done, 500));
		}
	}
}

export function meRouter(): Router {
	const router = Router();
	router.use(requireSession, requireActiveUser);

	router.get('/', async (req, res, next) => {
		try {
			const user = await db.user.findUniqueOrThrow({ where: { id: req.userId! } });
			// Старожилам ссылка достаётся здесь же, без переоткрытия сессии.
			res.json(toProfile(await ensureInviteToken(db, user)));
		} catch (err) {
			next(err);
		}
	});

	router.patch('/', rateLimit('me', 20), async (req, res, next) => {
		try {
			const userId = req.userId!;
			const parsed = reqBody(req);
			const current = await db.user.findUniqueOrThrow({ where: { id: userId } });

			const data: {
				customName?: string;
				age?: number | null;
				gender?: (typeof GENDERS)[number];
				coreColor?: string | null;
				flameColor?: string | null;
			} = {};

			if (has(parsed, 'displayName')) {
				if (current.nameLockedByAdmin) {
					throw forbidden('Имя изменено администратором');
				}
				data.customName = cleanName(str(parsed.displayName, 'displayName', { max: 64 }));
			}
			if (has(parsed, 'age')) {
				data.age = optional(parsed.age, () =>
					int(parsed.age, 'age', { min: AGE_MIN, max: AGE_MAX }),
				);
			}
			if (has(parsed, 'gender')) {
				data.gender = oneOf(parsed.gender, 'gender', GENDERS);
			}
			if (has(parsed, 'coreColor')) {
				data.coreColor = optional(parsed.coreColor, () =>
					oneOf(parsed.coreColor, 'coreColor', STAR_COLORS),
				);
			}
			if (has(parsed, 'flameColor')) {
				data.flameColor = optional(parsed.flameColor, () =>
					oneOf(parsed.flameColor, 'flameColor', STAR_COLORS),
				);
			}

			const user = await db.user.update({ where: { id: userId }, data });
			res.json(toProfile(user));
		} catch (err) {
			next(err);
		}
	});

	// Место новой звезды. Спираль freeSpot даёт только первое приближение: силы
	// потом уносят одинокого новичка на дальнюю орбиту, и замер показал сдвиг
	// на 1365 единиц из 1400 — звезда уезжала сразу после своего рождения.
	// Поэтому здесь же ждём пересчёт и отдаём место, на котором раскладка сошлась.
	// Секунда-две укладывается в окно профиля: клиент зовёт этот метод, когда его
	// открывает, а забирает ответ, когда человек его закрыл.
	router.post('/birth', async (req, res, next) => {
		try {
			const userId = req.userId!;
			const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
			if (user.x !== 0 || user.y !== 0) {
				res.json({ x: user.x, y: user.y });
				return;
			}

			const [others, links] = await Promise.all([
				db.user.findMany({
					where: { id: { not: userId } },
					select: { id: true, x: true, y: true, degree: true },
					orderBy: { id: 'asc' },
				}),
				db.link.findMany({
					where: { OR: [{ aId: userId }, { bId: userId }] },
					select: { aId: true, bId: true },
				}),
			]);

			// Нулевая точка означает «место ещё не выдано»: обходить её незачем.
			const placed = others.filter((other) => other.x !== 0 || other.y !== 0);
			const byId = new Map(placed.map((other) => [other.id, other]));

			// Пришедший по ссылке садится от пригласившего; порядок по id —
			// тот же, что у пересчёта, иначе точка разъедется с раскладкой.
			const neighbours = links
				.map((link) => (link.aId === userId ? link.bId : link.aId))
				.sort((a, b) => (a < b ? -1 : 1));
			const anchorId = neighbours.find((id) => byId.has(id));
			const anchor = anchorId === undefined ? undefined : byId.get(anchorId);

			const spot = placeNewStar({
				id: user.id,
				degree: user.degree,
				anchor: anchor && { x: anchor.x, y: anchor.y },
				taken: placed,
			});

			await db.user.update({ where: { id: userId }, data: { x: spot.x, y: spot.y } });
			await settleLayout();

			const settled = await db.user.findUniqueOrThrow({ where: { id: userId } });
			res.json({ x: settled.x, y: settled.y });
		} catch (err) {
			next(err);
		}
	});

	// Рождение показано. Ставится после анимации: закрыл приложение на середине —
	// увидит ещё раз, это лучше, чем не увидеть вовсе.
	router.post('/born', async (req, res, next) => {
		try {
			const user = await db.user.update({
				where: { id: req.userId! },
				data: { bornSeen: true },
			});
			res.json(toProfile(user));
		} catch (err) {
			next(err);
		}
	});

	router.delete('/', async (req, res, next) => {
		try {
			// Связи и приглашения уходят каскадом за пользователем.
			await db.user.delete({ where: { id: req.userId! } });
			await markLayoutDirty();
			clearSession(res);
			res.status(204).end();
		} catch (err) {
			next(err);
		}
	});

	return router;
}
