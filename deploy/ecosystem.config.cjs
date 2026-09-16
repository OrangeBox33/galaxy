// Конфиг pm2. Расширение .cjs обязательно: рядом package.json с "type": "module",
// и обычный .js pm2 не загрузит через require.
module.exports = {
	apps: [
		{
			name: 'galaxy',
			// Дерево собрано tsc как есть: server/src/*.js рядом с shared/*.js.
			script: 'server/src/index.js',
			cwd: '/root/dev/galaxy/dist',
			// Строго один инстанс: таймер пересчёта раскладки и воркер рассылки
			// держат состояние в памяти — вторая копия задублирует сообщения.
			instances: 1,
			exec_mode: 'fork',
			autorestart: true,
			max_restarts: 50,
			// Падает сразу после старта — не молотить рестартами.
			min_uptime: '10s',
			restart_delay: 2000,
			max_memory_restart: '400M',
			// Время в логах печатает pino, второй раз не надо.
			time: false,
			env: {
				NODE_ENV: 'production',
			},
		},
	],
};
