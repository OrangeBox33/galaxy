// Первый вход: место для звезды выдаётся до пересчёта раскладки, флаг рождения
// ставится один раз. Настоящий HTTP и настоящая БД — galaxy_test.
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import jwt from 'jsonwebtoken';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { BASE_PATH, SESSION_COOKIE } from '../../../shared/config.js';
import { createApp } from '../app.js';
import { db } from '../db.js';

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
	await db.link.deleteMany();
	await db.user.deleteMany();
	await db.layoutState.deleteMany();
});

function cookieFor(id: bigint): string {
	const token = jwt.sign({ sub: id.toString() }, 'test-session-secret', {
		algorithm: 'HS256',
		expiresIn: 3600,
	});
	return `${SESSION_COOKIE}=${token}`;
}

async function call(
	method: string,
	path: string,
	options: { as?: bigint; body?: unknown } = {},
): Promise<{ status: number; body: any }> {
	const res = await fetch(`${base}${path}`, {
		method,
		headers: {
			...(options.as === undefined ? {} : { cookie: cookieFor(options.as) }),
			...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
		},
		body: options.body === undefined ? undefined : JSON.stringify(options.body),
	});
	const text = await res.text();
	return { status: res.status, body: text === '' ? null : JSON.parse(text) };
}

describe('рождение звезды', () => {
	it('выдаёт место, свободное от соседей, и не двигает его при повторе', async () => {
		await db.user.create({ data: { id: 100n, customName: 'Сосед', x: 40, y: 0, degree: 1 } });
		await db.user.create({ data: { id: 200n, customName: 'Новичок' } });

		const first = await call('POST', '/api/me/birth', { as: 200n });
		expect(first.status).toBe(200);
		expect(Math.hypot(first.body.x, first.body.y)).toBeGreaterThan(0);
		expect(Math.hypot(first.body.x - 40, first.body.y)).toBeGreaterThan(10);

		// Точное равенство не годится: double через Postgres возвращается с точностью
		// до последнего разряда, а не бит в бит.
		const saved = await db.user.findUniqueOrThrow({ where: { id: 200n } });
		expect(saved.x).toBeCloseTo(first.body.x, 6);

		const second = await call('POST', '/api/me/birth', { as: 200n });
		expect(second.body.x).toBeCloseTo(first.body.x, 6);
		expect(second.body.y).toBeCloseTo(first.body.y, 6);
	});

	it('пришедший по ссылке садится рядом с пригласившим', async () => {
		await db.user.create({ data: { id: 100n, customName: 'Хозяин', x: 600, y: 600, degree: 1 } });
		await db.user.create({ data: { id: 300n, customName: 'Дальний', x: -600, y: -600, degree: 1 } });
		await db.user.create({ data: { id: 200n, customName: 'Гость', degree: 1 } });
		await db.link.create({ data: { aId: 100n, bId: 200n } });

		const { body } = await call('POST', '/api/me/birth', { as: 200n });

		const toHost = Math.hypot(body.x - 600, body.y - 600);
		const toFar = Math.hypot(body.x + 600, body.y + 600);
		expect(toHost).toBeLessThan(toFar);
	});

	it('рождение показывается один раз', async () => {
		await db.user.create({ data: { id: 200n, customName: 'Новичок' } });

		expect((await call('GET', '/api/me', { as: 200n })).body.needsBirth).toBe(true);
		expect((await call('POST', '/api/me/born', { as: 200n })).body.needsBirth).toBe(false);
		expect((await call('GET', '/api/me', { as: 200n })).body.needsBirth).toBe(false);
	});
});

describe('цвета звезды', () => {
	it('принимает цвет из палитры и отдаёт его в графе', async () => {
		await db.user.create({ data: { id: 200n, customName: 'Я' } });

		const saved = await call('PATCH', '/api/me', {
			as: 200n,
			body: { coreColor: '#F27380', flameColor: '#0595F5' },
		});
		expect(saved.status).toBe(200);
		expect(saved.body.coreColor).toBe('#F27380');

		const graph = await call('GET', '/api/graph', { as: 200n });
		expect(graph.body.nodes[0].flameColor).toBe('#0595F5');
	});

	it('цвет вне палитры не принимается', async () => {
		await db.user.create({ data: { id: 200n, customName: 'Я' } });

		const res = await call('PATCH', '/api/me', { as: 200n, body: { coreColor: '#123456' } });

		expect(res.status).toBe(400);
		expect((await db.user.findUniqueOrThrow({ where: { id: 200n } })).coreColor).toBeNull();
	});
});
