// Дамп базы по требованию (команда /save в боте). Формат тот же, что у
// недельного backup.sh: -Fc, разворачивается pg_restore.
import { spawn } from 'node:child_process';
import { env } from '../env.js';

// У ботов потолок на отправку документа 50 МБ; обрываем раньше, чем откажет Telegram.
const MAX_BYTES = 45 * 1024 * 1024;

let running = false;

export function isDumping(): boolean {
	return running;
}

export async function pgDump(): Promise<Buffer> {
	running = true;
	try {
		return await new Promise<Buffer>((resolve, reject) => {
			const child = spawn('pg_dump', ['-Fc', env.databaseUrl]);
			const chunks: Buffer[] = [];
			let size = 0;
			let stderr = '';

			child.stdout.on('data', (chunk: Buffer) => {
				size += chunk.length;
				if (size > MAX_BYTES) {
					child.kill();
					reject(new Error(`дамп перевалил за ${MAX_BYTES} байт`));
					return;
				}
				chunks.push(chunk);
			});
			child.stderr.on('data', (chunk: Buffer) => {
				stderr += chunk.toString();
			});
			child.on('error', reject);
			child.on('close', (code) => {
				if (code === 0) resolve(Buffer.concat(chunks));
				else reject(new Error(stderr.trim() || `pg_dump вышел с кодом ${code}`));
			});
		});
	} finally {
		running = false;
	}
}
