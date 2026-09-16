import { userInfo } from 'node:os';
import { defineConfig } from 'vitest/config';

// Тесты с БД ходят в отдельную базу galaxy_test; по умолчанию — локальный кластер,
// где роль совпадает с именем пользователя. Переопределяется GALAXY_TEST_DATABASE_URL.
const testDatabaseUrl =
	process.env.GALAXY_TEST_DATABASE_URL ??
	`postgresql://${userInfo().username}@127.0.0.1:5432/galaxy_test`;

export default defineConfig({
	test: {
		include: ['src/**/*.test.ts'],
		// Тесты с БД делят одну базу, поэтому идут по одному файлу за раз.
		fileParallelism: false,
		// env.ts падает на старте без переменных — тестам хватает фальшивых.
		env: {
			DATABASE_URL: testDatabaseUrl,
			PORT: '3005',
			PUBLIC_BASE_URL: 'https://example.test/galaxy',
			TELEGRAM_BOT_TOKEN: '123456:TEST-TOKEN-FOR-UNIT-TESTS',
			TELEGRAM_BOT_USERNAME: 'test_bot',
			TELEGRAM_WEBHOOK_SECRET: 'test-webhook-secret',
			SESSION_SECRET: 'test-session-secret',
			ADMIN_TELEGRAM_IDS: '1',
			AVATAR_DIR: '/tmp/galaxy-test-avatars',
			LAYOUT_RECOMPUTE_DEBOUNCE_MS: '4000',
		},
	},
});
