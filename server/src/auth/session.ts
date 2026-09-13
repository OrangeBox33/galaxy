// Сессия: JWT в httpOnly-куке. Раздел 4.2 ТЗ.
import jwt from 'jsonwebtoken';
import type { Request, Response } from 'express';
import { BASE_PATH, SESSION_COOKIE, SESSION_MAX_AGE_SEC } from '../../../shared/config.js';
import { env } from '../env.js';

type Payload = { sub: string };

export function issueSession(res: Response, userId: bigint): void {
	const token = jwt.sign({ sub: userId.toString() } satisfies Payload, env.sessionSecret, {
		algorithm: 'HS256',
		expiresIn: SESSION_MAX_AGE_SEC,
	});

	// Все три атрибута обязательны и ни один нельзя опустить:
	// SameSite=None — иначе кука не переживёт iframe Telegram;
	// Secure — обязателен вместе с SameSite=None;
	// Path=/galaxy — чтобы сессия не уходила в соседние приложения домена.
	res.cookie(SESSION_COOKIE, token, {
		httpOnly: true,
		secure: true,
		sameSite: 'none',
		path: BASE_PATH,
		maxAge: SESSION_MAX_AGE_SEC * 1000,
	});
}

export function clearSession(res: Response): void {
	res.clearCookie(SESSION_COOKIE, {
		httpOnly: true,
		secure: true,
		sameSite: 'none',
		path: BASE_PATH,
	});
}

// Разбор заголовка Cookie руками: ради одного значения тащить отдельную
// библиотеку незачем.
function readCookie(req: Request, name: string): string | null {
	const header = req.headers.cookie;
	if (!header) return null;
	for (const part of header.split(';')) {
		const eq = part.indexOf('=');
		if (eq === -1) continue;
		if (part.slice(0, eq).trim() !== name) continue;
		return decodeURIComponent(part.slice(eq + 1).trim());
	}
	return null;
}

export function readSession(req: Request): bigint | null {
	const token = readCookie(req, SESSION_COOKIE);
	if (!token) return null;
	try {
		const payload = jwt.verify(token, env.sessionSecret, { algorithms: ['HS256'] }) as Payload;
		if (typeof payload.sub !== 'string' || !/^-?\d+$/.test(payload.sub)) return null;
		return BigInt(payload.sub);
	} catch {
		return null;
	}
}
