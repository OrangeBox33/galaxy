// Конфиг pm2 для сервера galaxy. Лежит в корне задеплоенного dist на сервере.
// Расширение .cjs обязательно: у package.json рядом стоит "type": "module",
// и обычный .js pm2 не сможет загрузить через require.
module.exports = {
	apps: [
		{
			name: 'galaxy',
			// Дерево собрано tsc как есть: server/src/*.js рядом с shared/*.js.
			script: 'server/src/index.js',
			cwd: '/root/dev/galaxy/dist',
			// Строго один инстанс: таймер пересчёта раскладки (7.8) и воркер
			// рассылки (12) держат состояние в памяти процесса. Несколько копий
			// начнут дублировать работу и слать людям по два сообщения.
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
