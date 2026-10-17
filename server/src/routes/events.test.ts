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
	await db.analyticsEvent.deleteMany();
	await db.link.deleteMany();
	await db.user.deleteMany();
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

describe('события аналитики', () => {
	it('пачка пишется от имени владельца куки', async () => {
		await db.user.create({ data: { id: 100n, customName: 'Аня' } });

		const res = await call('POST', '/api/events', {
			as: 100n,
			body: {
				events: [
					{ type: 'star_tap', detail: 'other' },
					{ type: 'link', detail: 'suggest' },
					{ type: 'session', value: 42 },
					{ type: 'invite_open', detail: 'лишнее' },
				],
			},
		});
		expect(res.status).toBe(204);

		const rows = await db.analyticsEvent.findMany({ orderBy: { id: 'asc' } });
		expect(rows.map((row) => [row.userId, row.type, row.detail, row.value])).toEqual([
			[100n, 'star_tap', 'other', null],
			[100n, 'link', 'suggest', null],
			[100n, 'session', null, 42],
			[100n, 'invite_open', null, null],
		]);
	});

	it('чужие типы и уточнения отвергаются целиком', async () => {
		await db.user.create({ data: { id: 100n, customName: 'Аня' } });

		for (const events of [
			[{ type: 'visit' }],
			[{ type: 'link', detail: 'elsewhere' }],
			[{ type: 'session', value: -1 }],
		]) {
			expect((await call('POST', '/api/events', { as: 100n, body: { events } })).status).toBe(400);
		}
		expect(await db.analyticsEvent.count()).toBe(0);
	});

	it('без сессии не принимается', async () => {
		const res = await call('POST', '/api/events', { body: { events: [{ type: 'unlink' }] } });
		expect(res.status).toBe(401);
	});

	it('сводка считает события и людей, удалившиеся остаются в счёте', async () => {
		await db.user.create({ data: { id: 1n, customName: 'Админ' } });
		await db.user.create({ data: { id: 100n, customName: 'Аня', platform: 'ios' } });
		await db.analyticsEvent.createMany({
			data: [
				{ userId: 100n, type: 'visit', detail: 'direct' },
				{ userId: 100n, type: 'visit', detail: 'direct' },
				{ userId: 200n, type: 'visit', detail: 'link' },
				{ userId: 100n, type: 'session', value: 30 },
				{ userId: 100n, type: 'session', value: 12 },
			],
		});

		const res = await call('GET', '/api/admin/analytics', { as: 1n });
		expect(res.status).toBe(200);

		const direct = res.body.totals.find(
			(row: any) => row.type === 'visit' && row.detail === 'direct',
		);
		expect(direct).toMatchObject({ day: 2, week: 2, all: 2, users: 1 });
		expect(res.body.daily[0]).toMatchObject({ users: 2, visits: 3 });

		const anya = res.body.users.find((row: any) => row.id === '100');
		expect(anya).toMatchObject({
			name: 'Аня',
			platform: 'ios',
			sessionSec: 42,
			counts: { visit: 2, session: 2 },
		});
		expect(res.body.users.find((row: any) => row.id === '200')).toMatchObject({ name: null });
	});

	it('сводка только для админа', async () => {
		await db.user.create({ data: { id: 100n, customName: 'Аня' } });
		expect((await call('GET', '/api/admin/analytics', { as: 100n })).status).toBe(403);
	});
});
