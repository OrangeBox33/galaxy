import { PrismaClient } from '@prisma/client';
import { env } from './env.js';

export const db = new PrismaClient({
	datasources: { db: { url: env.databaseUrl } },
	log: [{ level: 'warn', emit: 'stdout' }, { level: 'error', emit: 'stdout' }],
});
