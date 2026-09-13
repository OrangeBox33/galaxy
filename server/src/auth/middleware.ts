// Авторизация запросов по сессионной куке. Проверка прав — на сервере и отдельно
// на каждом маршруте: клиентское «не показывать кнопку» защитой не считается.
import type { NextFunction, Request, Response } from 'express';
import { env, isAdmin } from '../env.js';
import { forbidden, unauthorized } from '../lib/errors.js';
import { readSession } from './session.js';
import { db } from '../db.js';

declare global {
	// eslint-disable-next-line @typescript-eslint/no-namespace
	namespace Express {
		interface Request {
			userId?: bigint;
		}
	}
}

export function requireSession(req: Request, _res: Response, next: NextFunction): void {
	const userId = readSession(req);
	if (userId === null) {
		next(unauthorized());
		return;
	}
	req.userId = userId;
	next();
}

// Заблокированного пользователя не пускаем дальше входа: звезда гаснет,
// а сам он видит экран «доступ закрыт».
export async function requireActiveUser(
	req: Request,
	_res: Response,
	next: NextFunction,
): Promise<void> {
	try {
		const userId = req.userId;
		if (userId === undefined) {
			next(unauthorized());
			return;
		}
		const user = await db.user.findUnique({
			where: { id: userId },
			select: { isBlocked: true },
		});
		if (!user) {
			next(unauthorized());
			return;
		}
		if (user.isBlocked) {
			next(forbidden('Доступ закрыт'));
			return;
		}
		next();
	} catch (err) {
		next(err);
	}
}

export function requireAdmin(req: Request, _res: Response, next: NextFunction): void {
	if (req.userId === undefined || !isAdmin(req.userId)) {
		next(forbidden('Нужны права администратора'));
		return;
	}
	next();
}

export function adminIds(): bigint[] {
	return [...env.adminIds];
}
