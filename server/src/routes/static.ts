// Ассеты и аватарки кешируются навсегда (в именах хеш), index.html — никогда:
// иначе после деплоя останется старый index на снесённые бандлы.
import express, { type Request, type Response, type Router } from 'express';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { env } from '../env.js';

const IMMUTABLE = 'public, max-age=31536000, immutable';

const here = dirname(fileURLToPath(import.meta.url));

// Клиент — в public/ рядом с server/ внутри dist; PUBLIC_DIR переопределяет путь.
export const PUBLIC_DIR = env.publicDir ? resolve(env.publicDir) : resolve(here, '../../../public');

export const INDEX_HTML = join(PUBLIC_DIR, 'index.html');

// Имя файла аватарки приходит из URL, поэтому проверяется регуляркой ДО обращения
// к диску: без этого — дыра на обход каталога.
const AVATAR_NAME = /^-?\d+-[0-9a-f]{8}\.webp$/;

export function mountAssets(router: Router): void {
	router.use(
		'/assets',
		express.static(join(PUBLIC_DIR, 'assets'), {
			immutable: true,
			maxAge: '1y',
			fallthrough: false,
			index: false,
		}),
	);

	router.use(
		express.static(PUBLIC_DIR, {
			index: false,
			setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache'),
		}),
	);
}

export function mountAvatars(router: Router): void {
	const serve = express.static(env.avatarDir, {
		immutable: true,
		maxAge: '1y',
		index: false,
		fallthrough: false,
	});

	router.use('/avatars', (req, res, next) => {
		const name = decodeURIComponent(req.path.replace(/^\//, ''));
		if (!AVATAR_NAME.test(name)) {
			res.status(404).end();
			return;
		}
		serve(req, res, next);
	});
}

// Перезагрузка страницы на /galaxy/admin должна открыть приложение, а не 404.
export function spaFallback(_req: Request, res: Response): void {
	if (!existsSync(INDEX_HTML)) {
		res.status(503)
			.type('text/plain; charset=utf-8')
			.send('Клиент не собран: нет public/index.html');
		return;
	}
	res.setHeader('Cache-Control', 'no-cache');
	res.sendFile(INDEX_HTML);
}

export { IMMUTABLE };
