// В логи не должны попадать initData, токен бота и содержимое кук.
import pino from 'pino';

export const log = pino({
	level: process.env.LOG_LEVEL || 'info',
	base: undefined, // без pid и hostname: процесс всё равно один
	timestamp: pino.stdTimeFunctions.isoTime,
});
