import { mkdirSync } from 'node:fs';
import { BASE_PATH } from '../../shared/config.js';
import { env } from './env.js';
import { db } from './db.js';
import { log } from './lib/log.js';
import { createApp } from './app.js';
import { startLayoutScheduler } from './layout/runner.js';
import { startOutboxWorker } from './bot/worker.js';

// Каталог аватарок лежит вне dist и переживает деплой; создаём, если его ещё нет.
mkdirSync(env.avatarDir, { recursive: true });

const server = createApp().listen(env.port, () => {
	log.info(`Galaxy слушает порт ${env.port}, базовый путь ${BASE_PATH}`);
	// Оба держат состояние в памяти: инстанс pm2 обязан быть ровно один.
	startLayoutScheduler();
	startOutboxWorker();
});

async function shutdown(signal: string): Promise<void> {
	log.info(`Получен ${signal}, останавливаюсь`);
	server.close();
	await db.$disconnect();
	process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
