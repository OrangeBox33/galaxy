// Все фото профиля для галереи в карточке звезды. Хранить их негде и незачем:
// смотрят их редко, поэтому сервер только проксирует Telegram — в адресе файла
// токен бота, клиенту его не отдать.
import { Router } from 'express';
import { db } from '../db.js';
import { notFound } from '../lib/errors.js';
import { log } from '../lib/log.js';
import { rateLimit } from '../lib/rateLimit.js';
import { bigint, int } from '../lib/validate.js';
import { requireActiveUser, requireSession } from '../auth/middleware.js';
import { fileUrl, profilePhotoIds } from '../bot/api.js';

const MAX_PHOTOS = 10;
const MAX_BYTES = 2 * 1024 * 1024;
// file_path у Telegram живёт не меньше часа; галерею листают минуты.
const CACHE_MS = 10 * 60 * 1000;

// Обещание, а не готовый список: первое фото и число фото клиент просит
// одновременно, и к Telegram должен уйти один запрос, а не два.
// Обещание, а не готовый список: первое фото и число фото клиент просит
// одновременно, и к Telegram должен уйти один запрос, а не два.
const cache = new Map<string, { ids: Promise<string[]>; at: number }>();

function photoIds(userId: bigint): Promise<string[]> {
	const key = userId.toString();
	const now = Date.now();
	const hit = cache.get(key);
	if (hit && now - hit.at < CACHE_MS) return hit.ids;

	for (const [id, entry] of cache) if (now - entry.at >= CACHE_MS) cache.delete(id);
	const ids = fetchPhotoIds(userId);
	cache.set(key, { ids, at: now });
	ids.catch(() => cache.delete(key));
	return ids;
}

async function fetchPhotoIds(userId: bigint): Promise<string[]> {
	const user = await db.user.findUnique({
		where: { id: userId },
		select: { isTest: true, isBlocked: true },
	});
	if (!user || user.isBlocked) throw notFound('Пользователь не найден');
	if (user.isTest) return [];

	try {
		return await profilePhotoIds(userId, MAX_PHOTOS);
	} catch (err) {
		// Без чата с ботом Telegram отвечает «user not found»: фото просто нет.
		log.warn({ err, userId: userId.toString() }, 'фото профиля не получены');
		return [];
	}
}

export function photosRouter(): Router {
	const router = Router();
	router.use(requireSession, requireActiveUser);

	router.get('/:userId', rateLimit('photos', 30), async (req, res, next) => {
		try {
			const ids = await photoIds(bigint(req.params.userId, 'userId'));
			res.json({ count: ids.length });
		} catch (err) {
			next(err);
		}
	});

	router.get('/:userId/:index', rateLimit('photo', 120), async (req, res, next) => {
		try {
			const ids = await photoIds(bigint(req.params.userId, 'userId'));
			const index = int(req.params.index, 'index', { min: 0 });
			if (index >= ids.length) throw notFound('Фото не найдено');

			const url = await fileUrl(ids[index]);
			if (!url) throw notFound('Фото не найдено');

			const upstream = await fetch(url, { signal: AbortSignal.timeout(10_000) });
			if (!upstream.ok) {
				log.warn({ status: upstream.status, userId: req.params.userId }, 'фото не скачано');
				throw notFound('Фото не найдено');
			}
			const image = Buffer.from(await upstream.arrayBuffer());
			if (image.byteLength > MAX_BYTES) throw notFound('Фото слишком велико');

			// Файловый сервер Telegram отвечает octet-stream, а фото профиля всегда jpeg.
			res.set('Content-Type', 'image/jpeg');
			res.set('Cache-Control', 'private, max-age=3600');
			res.send(image);
		} catch (err) {
			next(err);
		}
	});

	return router;
}
