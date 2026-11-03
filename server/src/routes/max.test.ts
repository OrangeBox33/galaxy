// Вебхук и вход из Макса через настоящий HTTP и БД galaxy_test.
import { createHmac } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { BASE_PATH } from '../../../shared/config.js';
import { db } from '../db.js';

const sent = vi.hoisted(() => [] as { maxUserId: bigint; text: string }[]);
vi.mock('../bot/max.js', async (importOriginal) => ({
	...(await importOriginal<typeof import('../bot/max.js')>()),
	sendMaxMessage: async (maxUserId: bigint, text: string) => {
		sent.push({ maxUserId, text });
	},
	maxDialogAvatar: async () => null,
}));

const { createApp } = await import('../app.js');
const { MAX_ID_OFFSET, maxWebhookSecret } = await import('../bot/max.js');

let server: Server;
let base: string;

beforeAll(async () => {
	server = createApp().listen(0);
	await new Promise<void>((resolve) => server.once('listening', resolve));
	base = `http://127.0.0.1:${(server.address() as AddressInfo).port}${BASE_PATH}`;
});

afterAll(async () => {
	server.close();
	await db.$disconnect();
});

beforeEach(async () => {
	sent.length = 0;
	await db.botOutbox.deleteMany();
	await db.analyticsEvent.deleteMany();
	await db.link.deleteMany();
	await db.user.deleteMany();
	await db.layoutState.deleteMany();
});

function webhook(update: unknown, secret = maxWebhookSecret) {
	return fetch(`${base}/max/webhook`, {
		method: 'POST',
		headers: { 'content-type': 'application/json', 'X-Max-Bot-Api-Secret': secret },
		body: JSON.stringify(update),
	});
}

// Вебхук отвечает до обработки, поэтому ждём результата в базе.
async function until(check: () => Promise<boolean>): Promise<void> {
	for (let i = 0; i < 50; i += 1) {
		if (await check()) return;
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
	throw new Error('не дождались');
}

function signInitData(token: string, fields: Record<string, string>): string {
	const pairs = Object.entries(fields)
		.map(([key, value]) => `${key}=${value}`)
		.sort();
	const secret = createHmac('sha256', 'WebAppData').update(token).digest();
	const hash = createHmac('sha256', secret).update(pairs.join('\n')).digest('hex');
	const params = new URLSearchParams(fields);
	params.set('hash', hash);
	return params.toString();
}

async function enter(path: string, token: string, id: number) {
	const initData = signInitData(token, {
		user: JSON.stringify({ id, first_name: 'Гость' }),
		auth_date: String(Math.floor(Date.now() / 1000)),
	});
	return fetch(`${base}/api/auth/${path}`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ initData }),
	});
}

describe('Макс', () => {
	it('вебхук без секрета отвечает 403', async () => {
		const res = await webhook({ update_type: 'bot_started' }, 'wrong');
		expect(res.status).toBe(403);
	});

	it('«Начать» по ссылке заводит звезду и связывает с хозяином ссылки', async () => {
		await db.user.create({ data: { id: 100n, customName: 'Хозяин', inviteToken: 'abc' } });

		const res = await webhook({
			update_type: 'bot_started',
			timestamp: Date.now(),
			chat_id: 5,
			user: { user_id: 777, first_name: 'Гость', is_bot: false },
			payload: 'abc',
		});
		expect(res.status).toBe(200);

		await until(async () => (await db.link.count()) === 1);
		const guest = await db.user.findUniqueOrThrow({ where: { maxId: 777n } });
		expect(guest.id).toBe(MAX_ID_OFFSET + 777n);
		expect(guest.telegramFirstName).toBe('Гость');
		expect(guest.inviteToken).not.toBeNull();
		expect(sent.map((m) => m.maxUserId)).toEqual([777n]);
	});

	it('вход принимает только подпись токеном Макса', async () => {
		expect((await enter('max', '123456:TEST-TOKEN-FOR-UNIT-TESTS', 42)).status).toBe(401);

		const res = await enter('max', 'TEST-MAX-TOKEN-FOR-UNIT-TESTS', 42);
		expect(res.status).toBe(200);
		const user = await db.user.findUniqueOrThrow({ where: { maxId: 42n } });
		expect(user.id).toBe(MAX_ID_OFFSET + 42n);
	});

	it('склеенного вход из Макса ведёт в телеграмную звезду и её не переписывает', async () => {
		await db.user.create({
			data: { id: 42n, maxId: 777n, telegramUsername: 'nik', telegramFirstName: 'Никита' },
		});

		const res = await enter('max', 'TEST-MAX-TOKEN-FOR-UNIT-TESTS', 777);
		expect(res.status).toBe(200);
		expect((await res.json()).id).toBe('42');

		const user = await db.user.findUniqueOrThrow({ where: { id: 42n } });
		expect(user.telegramUsername).toBe('nik');
		expect(user.telegramFirstName).toBe('Никита');
		expect(await db.user.count()).toBe(1);
	});

	it('один и тот же id в Telegram и Максе — две разные звезды', async () => {
		expect((await enter('telegram', '123456:TEST-TOKEN-FOR-UNIT-TESTS', 42)).status).toBe(200);
		expect((await enter('max', 'TEST-MAX-TOKEN-FOR-UNIT-TESTS', 42)).status).toBe(200);

		expect(await db.user.count()).toBe(2);
		expect((await db.user.findUniqueOrThrow({ where: { id: 42n } })).maxId).toBeNull();
	});
});
