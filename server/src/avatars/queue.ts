// Загрузка аватарок из Telegram. Очередь в памяти, параллелизм 2:
// аватарка не должна задерживать вход, а сотня скачиваний — забивать канал.
import { createHash } from 'node:crypto';
import { unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { db } from '../db.js';
import { env } from '../env.js';
import { log } from '../lib/log.js';
import { profilePhotoUrl } from '../bot/api.js';

const CONCURRENCY = 2;
const TIMEOUT_MS = 5000;
const MAX_BYTES = 2 * 1024 * 1024;

// Аватарка меняется редко: обновляем не чаще раза в неделю.
export const AVATAR_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// null — адрес узнаём у Bot API: после «Запустить» он даёт картинку крупнее,
// чем photo_url из initData.
type Task = { userId: bigint; photoUrl: string | null };

const queue: Task[] = [];
const queued = new Set<string>();
let running = 0;

export function scheduleAvatarFetch(userId: bigint, photoUrl: string | null): void {
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
	const url = task.photoUrl ?? (await profilePhotoUrl(task.userId));
	if (!url) return;

	const source = await download(url);

	// 192 px — тройной запас под самый крупный показ (64 CSS-px), иначе retina
	// растягивает картинку втрое и она рассыпается. Выше 320 Telegram не отдаёт.
	// webp q80 на этом размере — 6 КБ против 15 КБ у исходного jpeg.
	const image = await sharp(source)
		.resize(192, 192, { fit: 'cover' })
		.webp({ quality: 80 })
		.toBuffer();

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

	// В имени файла хеш содержимого, поэтому старый никем не кешируется.
	if (previous?.avatarFile && previous.avatarFile !== file) {
		await unlink(join(env.avatarDir, previous.avatarFile)).catch(() => undefined);
	}
}
