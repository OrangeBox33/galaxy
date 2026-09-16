// Быстрый слепок графа для опытов на живых данных. Не замена резервным копиям:
// те снимает pg_dump по расписанию.
//   node server/src/lib/snapshot.js save|restore <имя> | list
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from '../db.js';

const here = dirname(fileURLToPath(import.meta.url));
// Рядом с dist, а не внутри: деплой снимки не трогает.
const DIR = resolve(here, '../../../../snapshots');

type Snapshot = {
	savedAt: string;
	users: Record<string, unknown>[];
	links: Record<string, unknown>[];
	invites: Record<string, unknown>[];
	layout: Record<string, unknown> | null;
};

function plain(value: unknown): unknown {
	if (typeof value === 'bigint') return { __bigint: value.toString() };
	if (value instanceof Date) return { __date: value.toISOString() };
	if (Array.isArray(value)) return value.map(plain);
	if (value && typeof value === 'object') {
		const out: Record<string, unknown> = {};
		for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
			out[key] = plain(item);
		}
		return out;
	}
	return value;
}

function revive(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(revive);
	if (value && typeof value === 'object') {
		const record = value as Record<string, unknown>;
		if (typeof record.__bigint === 'string') return BigInt(record.__bigint);
		if (typeof record.__date === 'string') return new Date(record.__date);
		const out: Record<string, unknown> = {};
		for (const [key, item] of Object.entries(record)) out[key] = revive(item);
		return out;
	}
	return value;
}

async function save(name: string): Promise<void> {
	mkdirSync(DIR, { recursive: true });

	const snapshot: Snapshot = {
		savedAt: new Date().toISOString(),
		users: (await db.user.findMany({ orderBy: { id: 'asc' } })).map(
			(row) => plain(row) as Record<string, unknown>,
		),
		links: (await db.link.findMany({ orderBy: { id: 'asc' } })).map(
			(row) => plain(row) as Record<string, unknown>,
		),
		invites: (await db.invite.findMany({ orderBy: { id: 'asc' } })).map(
			(row) => plain(row) as Record<string, unknown>,
		),
		layout: plain(await db.layoutState.findUnique({ where: { id: 1 } })) as Record<
			string,
			unknown
		> | null,
	};

	const file = join(DIR, `${name}.json`);
	writeFileSync(file, JSON.stringify(snapshot, null, '\t'));
	console.log(
		`Снимок «${name}»: ${snapshot.users.length} звёзд, ${snapshot.links.length} связей → ${file}`,
	);
}

async function restore(name: string): Promise<void> {
	const file = join(DIR, `${name}.json`);
	const snapshot = JSON.parse(readFileSync(file, 'utf-8')) as Snapshot;

	// Порядок важен: сначала зависимые таблицы, потом пользователи.
	await db.invite.deleteMany();
	await db.link.deleteMany();
	await db.user.deleteMany();

	await db.user.createMany({ data: revive(snapshot.users) as never });
	await db.link.createMany({ data: revive(snapshot.links) as never });
	await db.invite.createMany({ data: revive(snapshot.invites) as never });

	if (snapshot.layout) {
		const layout = revive(snapshot.layout) as { version: number; params: unknown };
		await db.layoutState.upsert({
			where: { id: 1 },
			create: { id: 1, version: layout.version, params: layout.params as never, dirty: false },
			update: { version: layout.version, params: layout.params as never, dirty: false },
		});
	}

	console.log(
		`Восстановлен снимок «${name}» от ${snapshot.savedAt}: ` +
			`${snapshot.users.length} звёзд, ${snapshot.links.length} связей`,
	);
}

function list(): void {
	mkdirSync(DIR, { recursive: true });
	const files = readdirSync(DIR).filter((file) => file.endsWith('.json'));
	if (files.length === 0) {
		console.log('Снимков пока нет');
		return;
	}
	for (const file of files) {
		const snapshot = JSON.parse(readFileSync(join(DIR, file), 'utf-8')) as Snapshot;
		console.log(
			`${file.replace(/\.json$/, '').padEnd(20)} ${snapshot.savedAt}  ` +
				`${snapshot.users.length} звёзд, ${snapshot.links.length} связей`,
		);
	}
}

async function main(): Promise<void> {
	const [command, name] = process.argv.slice(2);

	if (command === 'list') {
		list();
	} else if (command === 'save' && name) {
		await save(name);
	} else if (command === 'restore' && name) {
		await restore(name);
	} else {
		console.log('Использование: snapshot.js save|restore <имя> | list');
		process.exitCode = 1;
	}
	await db.$disconnect();
}

main().catch(async (err: Error) => {
	console.error(`Не вышло: ${err.message}`);
	await db.$disconnect();
	process.exit(1);
});
