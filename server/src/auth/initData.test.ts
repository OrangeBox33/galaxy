// Токен здесь фальшивый и совпадает с тем, что подставляет vitest.config.ts.
import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { verifyInitData } from './initData.js';

const BOT_TOKEN = '123456:TEST-TOKEN-FOR-UNIT-TESTS';

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

const user = JSON.stringify({
	id: 111111111,
	first_name: 'Аня',
	last_name: 'П',
	username: 'anya',
	language_code: 'ru',
});

describe('initData', () => {
	it('валидные данные проходят', () => {
		const now = Date.now();
		const raw = signInitData({ user, auth_date: String(Math.floor(now / 1000)) });

		const result = verifyInitData(raw, now);
		expect(result).not.toBeNull();
		expect(result!.user.id).toBe(111111111n);
		expect(result!.user.username).toBe('anya');
	});

	it('start_param доезжает до сервера', () => {
		const now = Date.now();
		const raw = signInitData({
			user,
			auth_date: String(Math.floor(now / 1000)),
			start_param: 'abcdef0123456789',
		});

		expect(verifyInitData(raw, now)?.startParam).toBe('abcdef0123456789');
	});

	it('подменённые на один символ данные не проходят', () => {
		const now = Date.now();
		const raw = signInitData({ user, auth_date: String(Math.floor(now / 1000)) });

		const tampered = raw.replace('%D0%90%D0%BD%D1%8F', '%D0%90%D0%BD%D0%B0');
		expect(tampered).not.toBe(raw);
		expect(verifyInitData(tampered, now)).toBeNull();
	});

	it('подменённый хеш не проходит', () => {
		const now = Date.now();
		const raw = signInitData({ user, auth_date: String(Math.floor(now / 1000)) });
		const params = new URLSearchParams(raw);
		const hash = params.get('hash')!;
		params.set('hash', (hash[0] === 'a' ? 'b' : 'a') + hash.slice(1));

		expect(verifyInitData(params.toString(), now)).toBeNull();
	});

	it('данные старше суток не проходят', () => {
		const now = Date.now();
		const raw = signInitData({ user, auth_date: String(Math.floor(now / 1000) - 25 * 3600) });

		expect(verifyInitData(raw, now)).toBeNull();
	});

	it('без hash не проходит', () => {
		const params = new URLSearchParams({ user, auth_date: String(Math.floor(Date.now() / 1000)) });
		expect(verifyInitData(params.toString())).toBeNull();
	});
});
