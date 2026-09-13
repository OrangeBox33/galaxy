// Загрузка аватарок из Telegram (раздел 9). Очередь в памяти процесса
// с параллелизмом 2: аватарка не должна задерживать ответ на вход, а сотня
// одновременных скачиваний не должна забивать канал.
import { createHash } from 'node:crypto';
import { unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { db } from '../db.js';
import { env } from '../env.js';
import { log } from '../lib/log.js';

const CONCURRENCY = 2;
const TIMEOUT_MS = 5000;
const MAX_BYTES = 2 * 1024 * 1024;

type Task = { userId: bigint; photoUrl: string };

const queue: Task[] = [];
const queued = new Set<string>();
let running = 0;

export function scheduleAvatarFetch(userId: bigint, photoUrl: string): void {
	const key = userId.toString();
	if (queued.has(key)) return;
	queued.add(key);
	queue.push({ userId, photoUrl });
	pump();
}

function pump(): void {
	while (running < CONCURRENCY && queue.length > 0) {
		const task = queue.shift()!;
		running += 1;
		void process(task)
			.catch((err) => {
				// Ошибка любого шага — залогировать и оставить avatarFile как есть.
				// Не ретраим в цикле: у Telegram свои причины не отдавать фото.
				log.warn({ err, userId: task.userId.toString() }, 'аватарка не загружена');
			})
			.finally(() => {
				queued.delete(task.userId.toString());
				running -= 1;
				pump();
			});
	}
}

async function download(url: string): Promise<Buffer> {
	const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
	if (!res.ok) throw new Error(`ответ ${res.status}`);

	const declared = Number(res.headers.get('content-length') ?? '0');
	if (declared > MAX_BYTES) throw new Error('файл слишком велик');

	const buffer = Buffer.from(await res.arrayBuffer());
	if (buffer.byteLength > MAX_BYTES) throw new Error('файл слишком велик');
	return buffer;
}

async function process(task: Task): Promise<void> {
	const source = await download(task.photoUrl);

	// 64×64 webp — это 2–4 КБ: на 200 пользователей меньше мегабайта суммарно.
	const image = await sharp(source).resize(64, 64, { fit: 'cover' }).webp({ quality: 80 }).toBuffer();

	const hash = createHash('sha1').update(image).digest('hex').slice(0, 8);
	const file = `${task.userId}-${hash}.webp`;
	await writeFile(join(env.avatarDir, file), image);

	const previous = await db.user.findUnique({
		where: { id: task.userId },
		select: { avatarFile: true },
	});

	await db.user.update({
		where: { id: task.userId },
		data: { avatarFile: file, avatarFetchedAt: new Date() },
	});

	// Имя файла содержит хеш содержимого, поэтому старый файл больше не нужен
	// и никем не кешируется по этому адресу.
	if (previous?.avatarFile && previous.avatarFile !== file) {
		await unlink(join(env.avatarDir, previous.avatarFile)).catch(() => undefined);
	}
}
