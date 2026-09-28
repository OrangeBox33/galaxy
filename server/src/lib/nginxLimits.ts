// nginx отсекает лишнее до Node, и узнать об этом можно только из его журнала.
import { closeSync, openSync, readSync, statSync } from 'node:fs';
import { log } from './log.js';

const LOG_PATH = '/var/log/nginx/error.log';
const POLL_MS = 15_000;
// Под флудом журнал растёт на мегабайты за опрос: хватает хвоста, счёт тогда «не меньше».
const MAX_CHUNK = 1 << 20;
const LIMITED =
	/limiting (?:requests|connections)[^"]* by zone "(galaxy_\w+)", client: ([^,]+),.*?request: "(\S+) (\S+)/;

type Hit = { count: number; method: string; path: string };

export function watchNginxLimits(): void {
	let inode: number;
	let offset: number;
	try {
		const stat = statSync(LOG_PATH);
		inode = stat.ino;
		offset = stat.size;
	} catch {
		return;
	}

	setInterval(() => {
		let buf: Buffer;
		let start: number;
		let truncated: boolean;
		try {
			const stat = statSync(LOG_PATH);
			if (stat.ino !== inode || stat.size < offset) {
				inode = stat.ino;
				offset = 0;
			}
			if (stat.size === offset) return;

			truncated = stat.size - offset > MAX_CHUNK;
			start = truncated ? stat.size - MAX_CHUNK : offset;
			buf = Buffer.alloc(stat.size - start);
			const fd = openSync(LOG_PATH, 'r');
			try {
				readSync(fd, buf, 0, buf.length, start);
			} finally {
				closeSync(fd);
			}
		} catch (err) {
			// Не error: иначе сбой чтения журнала сам станет оповещением раз в 15 с.
			log.warn({ err }, 'журнал nginx не прочитан');
			return;
		}

		// Последняя строка может быть дописана не до конца: её заберёт следующий опрос.
		const end = buf.lastIndexOf('\n');
		if (end < 0) return;
		offset = start + end + 1;

		const hits = new Map<string, Hit>();
		for (const line of buf.toString('utf8', 0, end).split('\n')) {
			const match = LIMITED.exec(line);
			if (!match) continue;
			const [, zone, client, method, path] = match;
			const key = `${zone} ${client}`;
			const hit = hits.get(key);
			if (hit) hit.count += 1;
			else hits.set(key, { count: 1, method, path });
		}

		for (const [key, hit] of hits) {
			const [zone, client] = key.split(' ');
			log.error(
				{
					method: hit.method,
					path: hit.path,
					detail: `Отсечено за ${POLL_MS / 1000} с: ${truncated ? 'не меньше ' : ''}${hit.count}`,
				},
				`nginx: ${client} упёрся в лимит ${zone}`,
			);
		}
	}, POLL_MS).unref();
}
