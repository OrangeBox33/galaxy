import { db } from '../db.js';
import { log } from '../lib/log.js';
import { sendMessage, type TelegramError } from './api.js';

const TICK_MS = 5000;
const BATCH = 20;
const MAX_ATTEMPTS = 3;

// Пауза между попытками растёт экспоненциально; в памяти — процесс всё равно один.
const nextAttemptAt = new Map<string, number>();

export function startOutboxWorker(): void {
	const timer = setInterval(() => {
		void tick();
	}, TICK_MS);
	timer.unref();
}

async function tick(): Promise<void> {
	try {
		const rows = await db.botOutbox.findMany({
			where: { status: 'QUEUED' },
			orderBy: { createdAt: 'asc' },
			take: BATCH,
		});

		const now = Date.now();
		for (const row of rows) {
			const waitUntil = nextAttemptAt.get(row.id) ?? 0;
			if (waitUntil > now) continue;

			try {
				await sendMessage(row.userId, row.text);
				nextAttemptAt.delete(row.id);
				await db.botOutbox.update({
					where: { id: row.id },
					data: { status: 'SENT', sentAt: new Date(), attempts: row.attempts + 1 },
				});
			} catch (err) {
				const error = err as TelegramError;
				const attempts = row.attempts + 1;
				const giveUp = error.fatal === true || attempts >= MAX_ATTEMPTS;

				await db.botOutbox.update({
					where: { id: row.id },
					data: {
						attempts,
						lastError: error.message.slice(0, 500),
						status: giveUp ? 'FAILED' : 'QUEUED',
					},
				});

				if (giveUp) {
					nextAttemptAt.delete(row.id);
					log.warn(
						{ id: row.id, kind: row.kind, err: error.message },
						'сообщение не доставлено',
					);
				} else {
					nextAttemptAt.set(row.id, Date.now() + TICK_MS * 2 ** attempts);
				}
			}
		}
	} catch (err) {
		log.error({ err }, 'воркер рассылки упал на итерации');
	}
}
