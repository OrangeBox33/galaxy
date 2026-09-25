// Настоящий HTTP и настоящая БД; база отдельная — galaxy_test, см. vitest.config.ts.
import { createHmac } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import jwt from 'jsonwebtoken';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { BASE_PATH, SESSION_COOKIE } from '../../../shared/config.js';
import { createApp } from '../app.js';
import { db } from '../db.js';

const BOT_TOKEN = '123456:TEST-TOKEN-FOR-UNIT-TESTS';

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
	// Порядок важен: сначала зависимые таблицы, потом пользователи.
	await db.botOutbox.deleteMany();
	await db.adminAudit.deleteMany();
	await db.invite.deleteMany();
	await db.suggestionDismissal.deleteMany();
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

async function makeUser(id: bigint, name: string): Promise<bigint> {
	await db.user.create({ data: { id, customName: name } });
	return id;
}

function signInitData(fields: Record<string, string>): string {
	const pairs = Object.entries(fields)
		.map(([key, value]) => `${key}=${value}`)
		.sort();
	const secret = createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
	const hash = createHmac('sha256', secret).update(pairs.join('\n')).digest('hex');
	const params = new URLSearchParams(fields);
	params.set('hash', hash);
	return params.toString();
}

async function login(id: number, startParam?: string) {
	const initData = signInitData({
		user: JSON.stringify({ id, first_name: 'Гость' }),
		auth_date: String(Math.floor(Date.now() / 1000)),
		...(startParam ? { start_param: startParam } : {}),
	});
	return call('POST', '/api/auth/telegram', { body: { initData } });
}

describe('связи', () => {
	it('нельзя связаться с самим собой', async () => {
		const me = await makeUser(100n, 'Я');
		const res = await call('POST', '/api/links', { as: me, body: { targetId: '100' } });

		expect(res.status).toBe(409);
		expect(res.body.error.code).toBe('self_link');
		expect(await db.link.count()).toBe(0);
	});

	it('повторная связь даёт 409', async () => {
		const me = await makeUser(100n, 'Я');
		await makeUser(200n, 'Ты');

		expect((await call('POST', '/api/links', { as: me, body: { targetId: '200' } })).status).toBe(201);
		const second = await call('POST', '/api/links', { as: me, body: { targetId: '200' } });

		expect(second.status).toBe(409);
		expect(second.body.error.code).toBe('link_exists');
		expect(await db.link.count()).toBe(1);
	});

	it('(a,b) и (b,a) — одна и та же строка', async () => {
		const me = await makeUser(100n, 'Я');
		const other = await makeUser(200n, 'Ты');

		await call('POST', '/api/links', { as: me, body: { targetId: '200' } });
		const back = await call('POST', '/api/links', { as: other, body: { targetId: '100' } });

		expect(back.status).toBe(409);
		const links = await db.link.findMany();
		expect(links).toHaveLength(1);
		expect(links[0].aId).toBe(100n);
		expect(links[0].bId).toBe(200n);
	});

	it('развязать может любая из двух сторон', async () => {
		const me = await makeUser(100n, 'Я');
		const other = await makeUser(200n, 'Ты');
		await call('POST', '/api/links', { as: me, body: { targetId: '200' } });

		expect((await call('DELETE', '/api/links/100', { as: other })).status).toBe(204);
		expect(await db.link.count()).toBe(0);
	});

	it('удаление пользователя убирает его рёбра', async () => {
		const me = await makeUser(100n, 'Я');
		await makeUser(200n, 'Ты');
		await makeUser(300n, 'Он');
		await call('POST', '/api/links', { as: me, body: { targetId: '200' } });
		await call('POST', '/api/links', { as: me, body: { targetId: '300' } });
		expect(await db.link.count()).toBe(2);

		expect((await call('DELETE', '/api/me', { as: me })).status).toBe(204);
		expect(await db.link.count()).toBe(0);
		expect(await db.user.count()).toBe(2);
	});

	it('связь со второй стороной ставит ей уведомление в очередь', async () => {
		const me = await makeUser(100n, 'Аня');
		await makeUser(200n, 'Ты');
		await call('POST', '/api/links', { as: me, body: { targetId: '200' } });

		const outbox = await db.botOutbox.findMany();
		expect(outbox).toHaveLength(1);
		expect(outbox[0].userId).toBe(200n);
		expect(outbox[0].kind).toBe('linked');
		expect(outbox[0].text).toContain('Аня');
	});
});

describe('приглашения', () => {
	it('переход по ссылке зажигает звезду и связывает с пригласившим', async () => {
		const inviter = await makeUser(100n, 'Хозяин');
		const created = await call('POST', '/api/invites', { as: inviter, body: { label: 'Вася' } });
		expect(created.status).toBe(200);

		const res = await login(555, created.body.token);
		expect(res.status).toBe(200);

		const links = await db.link.findMany();
		expect(links).toHaveLength(1);
		expect(links[0].aId).toBe(100n);
		expect(links[0].bId).toBe(555n);

		const invite = await db.invite.findUniqueOrThrow({ where: { token: created.body.token } });
		expect(invite.status).toBe('ACCEPTED');
		expect(invite.acceptedById).toBe(555n);
	});

	it('повторное использование токена не создаёт дубль', async () => {
		const inviter = await makeUser(100n, 'Хозяин');
		const created = await call('POST', '/api/invites', { as: inviter, body: {} });

		await login(555, created.body.token);
		await login(555, created.body.token);
		await login(777, created.body.token);

		expect(await db.link.count()).toBe(1);
		expect(await db.user.count()).toBe(3);
	});

	it('принятие собственного приглашения не создаёт петлю', async () => {
		const inviter = await makeUser(100n, 'Хозяин');
		const created = await call('POST', '/api/invites', { as: inviter, body: {} });

		await login(100, created.body.token);

		expect(await db.link.count()).toBe(0);
		const invite = await db.invite.findUniqueOrThrow({ where: { token: created.body.token } });
		expect(invite.status).toBe('REVOKED');
	});

	it('чужие тусклые точки не попадают в граф', async () => {
		const mine = await makeUser(100n, 'Я');
		const stranger = await makeUser(200n, 'Чужой');

		await call('POST', '/api/invites', { as: mine, body: { label: 'моя точка' } });
		await call('POST', '/api/invites', { as: stranger, body: { label: 'чужая точка' } });

		const graph = await call('GET', '/api/graph', { as: mine });
		expect(graph.status).toBe(200);
		expect(graph.body.pending).toHaveLength(1);
		expect(graph.body.pending[0].label).toBe('моя точка');
	});

	it('отозванное приглашение больше не работает', async () => {
		const inviter = await makeUser(100n, 'Хозяин');
		const created = await call('POST', '/api/invites', { as: inviter, body: {} });

		expect((await call('DELETE', `/api/invites/${created.body.id}`, { as: inviter })).status).toBe(204);
		await login(555, created.body.token);

		expect(await db.link.count()).toBe(0);
	});
});

describe('постоянная ссылка', () => {
	async function tokenOf(id: bigint): Promise<string> {
		const user = await db.user.findUniqueOrThrow({ where: { id } });
		return user.inviteToken!;
	}

	it('вход выдаёт постоянную ссылку и отдаёт её в профиле', async () => {
		const res = await login(100);

		expect(res.status).toBe(200);
		const token = await tokenOf(100n);
		expect(res.body.inviteUrl).toBe(`https://t.me/test_bot?start=${token}`);
	});

	it('токен короткий, строчный и без служебных знаков', async () => {
		await login(100);

		expect(await tokenOf(100n)).toMatch(/^[0-9a-z]{3}$/);
	});

	it('регистр в ссылке не важен', async () => {
		await login(100);
		const token = await tokenOf(100n);

		await login(555, token.toUpperCase());

		expect(await db.link.count()).toBe(1);
	});

	it('токены разных людей не совпадают', async () => {
		await login(100);
		await login(200);
		await login(300);

		const tokens = new Set([await tokenOf(100n), await tokenOf(200n), await tokenOf(300n)]);
		expect(tokens.size).toBe(3);
	});

	it('старожил получает ссылку и через чтение профиля, без перевхода', async () => {
		const old = await makeUser(100n, 'Старожил');

		const res = await call('GET', '/api/me', { as: old });

		expect(res.body.inviteUrl).toMatch(/^https:\/\/t\.me\/test_bot\?start=[0-9a-z]{3}$/);
	});

	it('ссылка не меняется от входа к входу', async () => {
		await login(100);
		const first = await tokenOf(100n);
		await login(100);

		expect(await tokenOf(100n)).toBe(first);
	});

	it('старожилу без токена он достаётся при первом же входе', async () => {
		await makeUser(100n, 'Старожил');
		expect((await db.user.findUniqueOrThrow({ where: { id: 100n } })).inviteToken).toBeNull();

		const res = await login(100);

		expect(res.body.inviteUrl).toContain('start=');
	});

	it('по одной ссылке связываются все, кто по ней пришёл', async () => {
		await login(100);
		const token = await tokenOf(100n);

		await login(555, token);
		await login(777, token);

		const links = await db.link.findMany({ orderBy: { bId: 'asc' } });
		expect(links).toHaveLength(2);
		expect(links.map((link) => [link.aId, link.bId])).toEqual([
			[100n, 555n],
			[100n, 777n],
		]);
		expect((await db.user.findUniqueOrThrow({ where: { id: 100n } })).degree).toBe(2);
	});

	it('повторный приход по той же ссылке дубля не делает', async () => {
		await login(100);
		const token = await tokenOf(100n);

		await login(555, token);
		await login(555, token);

		expect(await db.link.count()).toBe(1);
		expect((await db.user.findUniqueOrThrow({ where: { id: 555n } })).degree).toBe(1);
	});

	it('своя собственная ссылка петли не создаёт', async () => {
		await login(100);
		const token = await tokenOf(100n);

		await login(100, token);

		expect(await db.link.count()).toBe(0);
	});

	it('хозяину ссылки уходит уведомление о госте', async () => {
		await login(100);
		const token = await tokenOf(100n);
		await db.botOutbox.deleteMany();

		await login(555, token);

		const outbox = await db.botOutbox.findMany();
		expect(outbox).toHaveLength(1);
		expect(outbox[0].userId).toBe(100n);
		expect(outbox[0].kind).toBe('invite_accepted');
		expect(outbox[0].text).toContain('Гость');
	});

	it('ссылка заблокированного не связывает', async () => {
		await login(100);
		const token = await tokenOf(100n);
		await db.user.update({ where: { id: 100n }, data: { isBlocked: true } });

		await login(555, token);

		expect(await db.link.count()).toBe(0);
	});
});

describe('доступ', () => {
	it('без сессии граф не отдаётся', async () => {
		expect((await call('GET', '/api/graph')).status).toBe(401);
	});

	it('заблокированного не пускают', async () => {
		await db.user.create({ data: { id: 100n, customName: 'Бан', isBlocked: true } });
		const res = await call('GET', '/api/graph', { as: 100n });

		expect(res.status).toBe(403);
	});

	it('админские маршруты закрыты для обычного пользователя', async () => {
		const me = await makeUser(100n, 'Я');
		expect((await call('GET', '/api/admin/users', { as: me })).status).toBe(403);
	});

	it('админ из ADMIN_TELEGRAM_IDS проходит', async () => {
		const admin = await makeUser(1n, 'Админ');
		expect((await call('GET', '/api/admin/users', { as: admin })).status).toBe(200);
	});
});

describe('профиль', () => {
	it('имя, переименованное админом, пользователь вернуть не может', async () => {
		const me = await makeUser(100n, 'Я');
		await db.user.update({ where: { id: me }, data: { nameLockedByAdmin: true } });

		const res = await call('PATCH', '/api/me', { as: me, body: { displayName: 'Другое' } });
		expect(res.status).toBe(403);
	});

	it('возраст вне допустимых границ отвергается с указанием поля', async () => {
		const me = await makeUser(100n, 'Я');
		const res = await call('PATCH', '/api/me', { as: me, body: { age: 3 } });

		expect(res.status).toBe(400);
		expect(res.body.error.field).toBe('age');
	});

	it('каскад имени: без customName и имени Telegram остаётся @username', async () => {
		await db.user.create({ data: { id: 100n, telegramUsername: 'anya' } });
		const res = await call('GET', '/api/me', { as: 100n });

		expect(res.body.name).toBe('@anya');
	});

	it('каскад имени: без username остаётся id', async () => {
		await db.user.create({ data: { id: 100n } });
		const res = await call('GET', '/api/me', { as: 100n });

		expect(res.body.name).toBe('100');
	});
});
