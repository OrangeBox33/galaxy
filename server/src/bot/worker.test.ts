import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../db.js';
import { normalizePair } from '../lib/pair.js';
import type { OutboxKind } from './outbox.js';

const sent = vi.hoisted(() => [] as { chatId: bigint; text: string }[]);
vi.mock('./api.js', async (importOriginal) => ({
	...(await importOriginal<typeof import('./api.js')>()),
	sendMessage: async (chatId: bigint, text: string) => {
		sent.push({ chatId, text });
	},
}));

const { tick, NOTIFY_INTERVAL_MS } = await import('./worker.js');

const NOON_MSK = new Date(Date.UTC(2026, 8, 28, 9, 0));
const HOUR = 60 * 60 * 1000;
const at = (base: Date, ms: number) => new Date(base.getTime() + ms);

const ME = 100n;

beforeEach(async () => {
	sent.length = 0;
	await db.botOutbox.deleteMany();
	await db.link.deleteMany();
	await db.user.deleteMany();
	await db.user.create({ data: { id: ME, customName: 'Я' } });
});

afterAll(async () => {
	await db.$disconnect();
});

async function event(kind: OutboxKind, actorId: bigint, name: string): Promise<void> {
	await db.user.create({ data: { id: actorId, customName: name } });
	const [aId, bId] = normalizePair(ME, actorId);
	await db.link.create({ data: { aId, bId, createdById: actorId } });
	await db.botOutbox.create({ data: { userId: ME, kind, actorId } });
}

describe('уведомления бота', () => {
	it('первое уходит сразу, следующие ждут суток и приходят одной сводкой', async () => {
		await event('linked', 200n, 'Аня');
		await tick(NOON_MSK);
		expect(sent).toHaveLength(1);
		expect(sent[0].text).toContain('Аня</b> отметил(а) знакомство');

		await event('by_link', 300n, 'Петя');
		await event('linked', 400n, 'Вася');
		await tick(at(NOON_MSK, HOUR));
		expect(sent).toHaveLength(1);

		await tick(at(NOON_MSK, NOTIFY_INTERVAL_MS));
		expect(sent).toHaveLength(2);
		expect(sent[1].text).toContain('По твоей ссылке пришёл(ла) <b>Петя</b>');
		expect(sent[1].text).toContain('Отметил(а) знакомство с тобой <b>Вася</b>');
	});

	it('ночью по Москве молчит до десяти утра', async () => {
		await event('linked', 200n, 'Аня');
		const night = new Date(Date.UTC(2026, 8, 28, 23, 0));

		await tick(night);
		expect(sent).toHaveLength(0);

		await tick(new Date(Date.UTC(2026, 8, 29, 7, 0)));
		expect(sent).toHaveLength(1);
	});

	it('разорванная к отправке связь в сообщение не попадает', async () => {
		await event('linked', 200n, 'Аня');
		await event('linked', 300n, 'Петя');
		await db.link.deleteMany({ where: { OR: [{ aId: 200n }, { bId: 200n }] } });

		await tick(NOON_MSK);

		expect(sent).toHaveLength(1);
		expect(sent[0].text).toContain('Петя');
		expect(sent[0].text).not.toContain('Аня');
		expect(await db.botOutbox.count({ where: { status: 'DROPPED' } })).toBe(1);
	});

	it('в строке сводки не больше пяти имён', async () => {
		for (let i = 1; i <= 7; i++) await event('linked', BigInt(200 + i), `Друг${i}`);

		await tick(NOON_MSK);

		expect(sent[0].text).toContain('<b>Друг5</b> и ещё 2');
		expect(sent[0].text).not.toContain('Друг6');
	});
});
