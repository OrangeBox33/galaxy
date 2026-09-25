// Личная ссылка: адрес, токен и вход по ней. Отдельным модулем, потому что
// нужна и вебхуку бота, и входу, и профилю.
import { randomInt } from 'node:crypto';
import type { Prisma, User } from '@prisma/client';
import { MAX_LINKS_PER_USER } from '../../../shared/config.js';
import { env } from '../env.js';
import { displayName } from './names.js';
import { normalizePair } from './pair.js';
import { markLayoutDirty } from '../layout/state.js';
import { enqueue, escapeHtml } from '../bot/outbox.js';

export const SHARE_TEXT =
	'Привет! Я собираю карту своих друзей и знакомых — она выглядит как звёздное небо, ' +
	'где каждый человек звезда, а знакомства — линии между ними. ' +
	'Открой ссылку, и рядом с моей звездой зажжётся твоя.';

// start (а не startapp) ведёт в чат с ботом, а не сразу в Mini App: без этого
// чата бот не может написать человеку — рассылка падала с «chat not found».
export function inviteUrl(token: string): string {
	return `https://t.me/${env.botUsername}?start=${token}`;
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

// Регистр в ссылке не значим: токены выдаются строчными, чужой приводим к ним же.
export function normalizeInviteToken(token: string): string {
	return token.toLowerCase();
}

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
export async function ensureInviteToken(tx: Prisma.TransactionClient, user: User): Promise<User> {
	if (user.inviteToken) return user;
	return tx.user.update({
		where: { id: user.id },
		data: { inviteToken: await freshInviteToken(tx) },
	});
}

async function countLinks(tx: Prisma.TransactionClient, userId: bigint): Promise<number> {
	return tx.link.count({ where: { OR: [{ aId: userId }, { bId: userId }] } });
}

// Вход по чьей-то ссылке. Зовётся внутри той же транзакции, что и создание
// пользователя. Повторный приход того же человека ничего не ломает: связь уже
// есть, второй раз не создаём.
export async function linkByToken(
	tx: Prisma.TransactionClient,
	userId: bigint,
	token: string,
): Promise<void> {
	const host = await tx.user.findUnique({
		where: { inviteToken: normalizeInviteToken(token) },
	});
	if (!host || host.isBlocked || host.id === userId) return;

	const [aId, bId] = normalizePair(host.id, userId);
	if (await tx.link.findUnique({ where: { aId_bId: { aId, bId } } })) return;

	// Предел связей — тот же, что у ручного «Связать»: ссылка не лазейка мимо него.
	if ((await countLinks(tx, host.id)) >= MAX_LINKS_PER_USER) return;
	if ((await countLinks(tx, userId)) >= MAX_LINKS_PER_USER) return;

	await tx.link.create({ data: { aId, bId, createdById: host.id } });
	await tx.user.update({ where: { id: aId }, data: { degree: { increment: 1 } } });
	await tx.user.update({ where: { id: bId }, data: { degree: { increment: 1 } } });

	const guest = await tx.user.findUnique({ where: { id: userId } });
	if (guest) {
		await enqueue(
			tx,
			host.id,
			'by_link',
			`🌟 <b>${escapeHtml(displayName(guest))}</b> пришёл(ла) по твоей ссылке — ` +
				'рядом с твоей звездой загорелась новая.',
		);
	}

	await markLayoutDirty(tx);
}
