import { db } from '../db.js';
import { log } from '../lib/log.js';
import { displayName } from '../lib/names.js';
import { normalizePair } from '../lib/pair.js';
import { OPEN_MAP_KEYBOARD, sendMessage, type TelegramError } from './api.js';
import { composeMessage, type OutboxEvent } from './outbox.js';

const TICK_MS = 5000;
const BATCH = 20;
const MAX_ATTEMPTS = 3;

export const NOTIFY_INTERVAL_MS = 24 * 60 * 60 * 1000;

// Пишем только с 10:00 до полуночи по Москве; перевода часов там нет, всегда UTC+3.
const MSK_OFFSET_H = 3;
const DAY_START_MSK_H = 10;

// Пауза между попытками растёт экспоненциально; в памяти — процесс всё равно один.
const nextAttemptAt = new Map<bigint, number>();

export function startOutboxWorker(): void {
	const timer = setInterval(() => {
		void tick();
	}, TICK_MS);
	timer.unref();
}

function isDaytime(now: Date): boolean {
	return (now.getUTCHours() + MSK_OFFSET_H) % 24 >= DAY_START_MSK_H;
}

export async function tick(now = new Date()): Promise<void> {
	try {
		if (!isDaytime(now)) return;

		const recipients = await db.user.findMany({
			where: {
				outbox: { some: { status: 'QUEUED' } },
				OR: [
					{ lastNotifiedAt: null },
					{ lastNotifiedAt: { lte: new Date(now.getTime() - NOTIFY_INTERVAL_MS) } },
				],
			},
			select: { id: true },
			take: BATCH,
		});

		for (const { id } of recipients) {
			if ((nextAttemptAt.get(id) ?? 0) > now.getTime()) continue;
			await deliver(id, now);
		}
	} catch (err) {
		log.error({ err }, 'воркер рассылки упал на итерации');
	}
}

// Всё накопленное — одним сообщением. Событие, которое успело устареть,
// в него не попадает: связь разорвана, автор заблокирован или уже упомянут.
async function deliver(userId: bigint, now: Date): Promise<void> {
	const rows = await db.botOutbox.findMany({
		where: { userId, status: 'QUEUED' },
		orderBy: { createdAt: 'asc' },
		include: { actor: true },
	});

	const events: OutboxEvent[] = [];
	const kept: string[] = [];
	const dropped: string[] = [];
	const mentioned = new Set<bigint>();
	for (const row of rows) {
		const actor = row.actor;
		const fresh =
			actor !== null &&
			!actor.isBlocked &&
			!mentioned.has(actor.id) &&
			(await isLinked(userId, actor.id));
		if (fresh) {
			mentioned.add(actor.id);
			kept.push(row.id);
			events.push({ kind: row.kind, name: displayName(actor) });
		} else {
			dropped.push(row.id);
		}
	}

	if (dropped.length > 0) {
		await db.botOutbox.updateMany({ where: { id: { in: dropped } }, data: { status: 'DROPPED' } });
	}
	if (events.length === 0) return;

	try {
		await sendMessage(userId, composeMessage(events), OPEN_MAP_KEYBOARD);
		nextAttemptAt.delete(userId);
		await db.$transaction([
			db.botOutbox.updateMany({
				where: { id: { in: kept } },
				data: { status: 'SENT', sentAt: now, attempts: { increment: 1 } },
			}),
			db.user.update({ where: { id: userId }, data: { lastNotifiedAt: now } }),
		]);
	} catch (err) {
		const error = err as TelegramError;
		const attempts = Math.max(...rows.filter((r) => kept.includes(r.id)).map((r) => r.attempts)) + 1;
		const giveUp = error.fatal === true || attempts >= MAX_ATTEMPTS;

		await db.botOutbox.updateMany({
			where: { id: { in: kept } },
			data: {
				attempts: { increment: 1 },
				lastError: error.message.slice(0, 500),
				status: giveUp ? 'FAILED' : 'QUEUED',
			},
		});

		if (giveUp) {
			nextAttemptAt.delete(userId);
			log.warn(
				{ userId: String(userId), events: kept.length, err: error.message },
				'сообщение не доставлено',
			);
		} else {
			nextAttemptAt.set(userId, now.getTime() + TICK_MS * 2 ** attempts);
		}
	}
}

async function isLinked(x: bigint, y: bigint): Promise<boolean> {
	const [aId, bId] = normalizePair(x, y);
	return (await db.link.count({ where: { aId, bId } })) > 0;
}
