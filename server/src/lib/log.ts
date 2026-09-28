// В логи не должны попадать initData, токен бота и содержимое кук.
import pino from 'pino';

const level = process.env.LOG_LEVEL || 'info';

// Пусто, пока index.ts не включит оповещения: скрипты и тесты в Telegram не пишут.
let errorSink: ((line: string) => void) | null = null;

export function onErrorLine(sink: (line: string) => void): void {
	errorSink = sink;
}

export const log = pino(
	{
		level,
		base: undefined, // без pid и hostname: процесс всё равно один
		timestamp: pino.stdTimeFunctions.isoTime,
	},
	pino.multistream([
		{ level, stream: process.stdout },
		{ level: 'error', stream: { write: (line: string) => errorSink?.(line) } },
	]),
);
