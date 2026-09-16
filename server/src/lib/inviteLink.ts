// Ссылка-приглашение отдельным модулем: нужна и роутеру приглашений, и профилю,
// а общий импорт дешевле кольца между ними.
import { randomBytes, randomInt } from 'node:crypto';
import type { Prisma, User } from '@prisma/client';
import { env } from '../env.js';

export const SHARE_TEXT =
	'Привет! Я собираю карту своих друзей и знакомых — она выглядит как звёздное небо, ' +
	'где каждый человек звезда, а знакомства — линии между ними. ' +
	'Открой ссылку, и рядом с моей звездой загорится твоя.';

// startapp (а не start) открывает Mini App сразу, минуя чат с ботом.
export function inviteUrl(token: string): string {
	return `https://t.me/${env.botUsername}?startapp=${token}`;
}

// Три знака, цифры и строчная латиница: ссылка видна целиком в сообщении
// и диктуется голосом без уточнения регистра. Всего 36³ = 46 656 вариантов —
// осознанный размен на красоту ссылки; поднять длину — одна эта константа.
const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';
const TOKEN_LENGTH = 3;

function randomToken(length: number): string {
	let token = '';
	// randomInt, а не остаток от случайного байта: 256 на 36 не делится,
	// и первые знаки алфавита выпадали бы чаще прочих.
	for (let i = 0; i < length; i += 1) token += ALPHABET[randomInt(ALPHABET.length)];
	return token;
}

// Токен одноразовых приглашений — тех, что под коробкой: в переписке он не живёт
// и коротким быть не обязан.
export function newInviteToken(): string {
	return randomBytes(16).toString('base64url');
}

// Регистр в ссылке не значим: токены выдаются строчными, чужой приводим к ним же.
export function normalizeInviteToken(token: string): string {
	return token.toLowerCase();
}

// Занятость проверяется заранее, а не ловится по ошибке уникального индекса:
// иначе на коллизии падал бы весь вход.
// Занятость проверяется заранее, а не ловится по ошибке уникального индекса:
// иначе на коллизии падал бы весь вход.
export async function freshInviteToken(tx: Prisma.TransactionClient): Promise<string> {
	for (let attempt = 0; attempt < 12; attempt += 1) {
		// Восемь занятых подряд — теснота, а не невезение: дальше берём на знак
		// длиннее. На тысяче пользователей занят каждый сорок шестой токен.
		const length = TOKEN_LENGTH + (attempt < 8 ? 0 : attempt < 10 ? 1 : 2);
		const candidate = randomToken(length);
		const taken = await tx.user.findUnique({
			where: { inviteToken: candidate },
			select: { id: true },
		});
		if (!taken) return candidate;
	}
	return randomToken(TOKEN_LENGTH + 4);
}

// Токен выдаётся один раз и больше не меняется. Nullable в схеме — ради строк,
// заведённых до постоянных ссылок: им токен достаётся при первом обращении.
export async function ensureInviteToken(
	tx: Prisma.TransactionClient,
	user: User,
): Promise<User> {
	if (user.inviteToken) return user;
	return tx.user.update({
		where: { id: user.id },
		data: { inviteToken: await freshInviteToken(tx) },
	});
}
