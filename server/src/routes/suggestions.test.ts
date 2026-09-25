// Возможные друзья: сама математика лежит в shared (её крутит клиент),
// на сервере живёт только память об отказах.
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import jwt from 'jsonwebtoken';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { BASE_PATH, SESSION_COOKIE } from '../../../shared/config.js';
import { suggestFriends, type SuggestNode } from '../../../shared/suggest.js';
import { createApp } from '../app.js';
import { db } from '../db.js';

describe('кого предложить', () => {
	// Граф: я (1) знаком с 2, 3 и 7; у 2 в друзьях 4, 5 и 8, у 3 — 4 и 8,
	// у 7 — тоже 8. Значит 8 — трое общих знакомых, 4 — двое, 5 — один
	// (порога не проходит), а 2, 3 и 7 уже мои друзья.
	const nodes: SuggestNode[] = ['1', '2', '3', '4', '5', '6', '7', '8'].map((id) => ({
		id,
		degree: Number(id),
		isBlocked: false,
	}));
	const edges: [string, string][] = [
		['1', '2'],
		['1', '3'],
		['2', '4'],
		['2', '5'],
		['3', '4'],
		['1', '7'],
		['2', '8'],
		['3', '8'],
		['7', '8'],
	];

	it('предлагает друзей друзей, и больше общих — выше', () => {
		const out = suggestFriends({ me: '1', nodes, edges }, new Set());

		expect(out.map((item) => item.node.id)).toEqual(['8', '4']);
		expect(out[0].mutual).toBe(3);
		expect(out[1].mutual).toBe(2);
	});

	it('один общий друг порога не проходит', () => {
		const out = suggestFriends({ me: '1', nodes, edges }, new Set());

		expect(out.map((item) => item.node.id)).not.toContain('5');
	});

	it('свои друзья, сам человек и отказы в список не попадают', () => {
		const out = suggestFriends({ me: '1', nodes, edges }, new Set(['8']));

		expect(out.map((item) => item.node.id)).toEqual(['4']);
	});

	it('погасшие звёзды не предлагаются', () => {
		const dimmed = nodes.map((node) => (node.id === '8' ? { ...node, isBlocked: true } : node));
		const out = suggestFriends({ me: '1', nodes: dimmed, edges }, new Set());

		expect(out.map((item) => item.node.id)).toEqual(['4']);
	});

	it('у одиночки предлагать нечего', () => {
		expect(suggestFriends({ me: '6', nodes, edges }, new Set())).toEqual([]);
	});
});

describe('отказы', () => {
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
		await db.suggestionDismissal.deleteMany();
		await db.link.deleteMany();
		await db.botOutbox.deleteMany();
		await db.user.deleteMany();
	});

	function cookieFor(id: bigint): string {
		const token = jwt.sign({ sub: id.toString() }, 'test-session-secret', {
			algorithm: 'HS256',
			expiresIn: 3600,
		});
		return `${SESSION_COOKIE}=${token}`;
	}

	async function call(method: string, path: string, options: { as: bigint; body?: unknown }) {
		const res = await fetch(`${base}${path}`, {
			method,
			headers: {
				cookie: cookieFor(options.as),
				...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
			},
			body: options.body === undefined ? undefined : JSON.stringify(options.body),
		});
		const text = await res.text();
		return { status: res.status, body: text === '' ? null : JSON.parse(text) };
	}

	it('«нет» запоминается и возвращается в графе', async () => {
		await db.user.create({ data: { id: 100n, customName: 'Я' } });
		await db.user.create({ data: { id: 200n, customName: 'Ты' } });

		const res = await call('POST', '/api/suggestions/dismiss', { as: 100n, body: { targetId: '200' } });
		expect(res.status).toBe(204);

		const graph = await call('GET', '/api/graph', { as: 100n });
		expect(graph.body.dismissed).toEqual(['200']);

		// Второму отказ не виден: он односторонний.
		const theirs = await call('GET', '/api/graph', { as: 200n });
		expect(theirs.body.dismissed).toEqual([]);
	});

	it('повторное «нет» не ошибка', async () => {
		await db.user.create({ data: { id: 100n, customName: 'Я' } });
		await db.user.create({ data: { id: 200n, customName: 'Ты' } });

		await call('POST', '/api/suggestions/dismiss', { as: 100n, body: { targetId: '200' } });
		const again = await call('POST', '/api/suggestions/dismiss', { as: 100n, body: { targetId: '200' } });

		expect(again.status).toBe(204);
		expect(await db.suggestionDismissal.count()).toBe(1);
	});

	it('нельзя отказаться от себя и от несуществующего', async () => {
		await db.user.create({ data: { id: 100n, customName: 'Я' } });

		const self = await call('POST', '/api/suggestions/dismiss', { as: 100n, body: { targetId: '100' } });
		expect(self.status).toBe(409);

		const ghost = await call('POST', '/api/suggestions/dismiss', { as: 100n, body: { targetId: '999' } });
		expect(ghost.status).toBe(404);
		expect(await db.suggestionDismissal.count()).toBe(0);
	});
});
