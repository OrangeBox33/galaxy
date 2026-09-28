import { env } from '../env.js';
import { sendMessage } from '../bot/api.js';
import { log, onErrorLine } from './log.js';

const WINDOW_MS = 10 * 60_000;
const HOURLY_CAP = 20;
const STACK_LINES = 6;

type Entry = { repeats: number; text: string };

const seen = new Map<string, Entry>();
const sentAt: number[] = [];
const inFlight = new Set<Promise<void>>();

type Line = {
	msg?: string;
	method?: string;
	path?: string;
	detail?: string;
	err?: { type?: string; message?: string; stack?: string };
};

const escape = (text: string) =>
	text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function format(line: Line): string {
	const parts = [`🔴 <b>Galaxy: ${escape(line.msg ?? 'ошибка')}</b>`];
	if (line.method && line.path) parts.push(escape(`${line.method} ${line.path}`));
	if (line.detail) parts.push(escape(line.detail));
	const detail = line.err?.stack ?? line.err?.message;
	if (detail) {
		parts.push(`<pre>${escape(detail.split('\n').slice(0, STACK_LINES).join('\n'))}</pre>`);
	}
	return parts.join('\n');
}

function send(text: string): void {
	const now = Date.now();
	while (sentAt.length > 0 && now - sentAt[0] > 60 * 60_000) sentAt.shift();
	if (sentAt.length >= HOURLY_CAP) return;
	sentAt.push(now);

	// warn, а не error: иначе сбой отправки сам станет оповещением.
	const sending = sendMessage(env.adminId, text.slice(0, 4000))
		.catch((err) => log.warn({ err }, 'оповещение не отправлено'))
		.finally(() => inFlight.delete(sending));
	inFlight.add(sending);
}

function flush(key: string): void {
	const entry = seen.get(key)!;
	if (entry.repeats === 0) {
		seen.delete(key);
		return;
	}
	send(`${entry.text}\n\nПовторилась ×${entry.repeats} за 10 мин`);
	entry.repeats = 0;
	setTimeout(() => flush(key), WINDOW_MS).unref();
}

function report(raw: string): void {
	let line: Line;
	try {
		line = JSON.parse(raw) as Line;
	} catch {
		return;
	}
	const key = `${line.msg}|${line.err?.message}`;
	const text = format(line);

	const entry = seen.get(key);
	if (entry) {
		entry.repeats += 1;
		entry.text = text;
		return;
	}
	seen.set(key, { repeats: 0, text });
	setTimeout(() => flush(key), WINDOW_MS).unref();
	send(text);
}

export function startAlerts(): void {
	onErrorLine(report);
}

export async function drainAlerts(timeoutMs: number): Promise<void> {
	await Promise.race([
		Promise.allSettled([...inFlight]),
		new Promise((resolve) => setTimeout(resolve, timeoutMs)),
	]);
}
