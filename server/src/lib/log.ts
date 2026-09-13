// Логи. pino пишет JSON в stdout, pm2 складывает его в свои файлы.
// В логах не должно появляться initData, токена бота и содержимого сессионных кук (раздел 14).
import pino from 'pino';

export const log = pino({
	level: process.env.LOG_LEVEL || 'info',
	base: undefined, // без pid и hostname: процесс всё равно один
	timestamp: pino.stdTimeFunctions.isoTime,
});
