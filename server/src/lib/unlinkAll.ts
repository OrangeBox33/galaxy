// Развязать человека со всеми: инструмент для опытов, не часть приложения.
//   node server/src/lib/unlinkAll.js <id>            развязать
//   node server/src/lib/unlinkAll.js <id> --dry      только показать, кого
//   node server/src/lib/unlinkAll.js who             кто есть кто (id и связи)
//
// Нужен, чтобы проверять «возможных друзей» не одним заходом: связался со всеми —
// предлагать некого. Уведомлений при разрыве бот не шлёт: это приватное действие.
import { db } from '../db.js';
import { displayName } from './names.js';
import { markLayoutDirty } from '../layout/state.js';

async function who(): Promise<void> {
	const users = await db.user.findMany({ orderBy: { degree: 'desc' } });
	for (const user of users) {
		const mark = user.isTest ? ' (тестовая)' : '';
		console.log(`${user.id.toString().padEnd(14)} ${user.degree} связей  ${displayName(user)}${mark}`);
	}
}

async function unlinkAll(id: bigint, dry: boolean): Promise<void> {
	const user = await db.user.findUnique({ where: { id } });
	if (!user) throw new Error(`Нет такого пользователя: ${id}`);

	const links = await db.link.findMany({
		where: { OR: [{ aId: id }, { bId: id }] },
		include: { a: true, b: true },
	});

	console.log(`${displayName(user)} (${id}): связей ${links.length}`);
	for (const link of links) {
		console.log(`  — ${displayName(link.aId === id ? link.b : link.a)}`);
	}
	if (dry) {
		console.log('Ничего не тронуто: это пробный прогон.');
		return;
	}
	if (links.length === 0) return;

	await db.$transaction(async (tx) => {
		await tx.link.deleteMany({ where: { OR: [{ aId: id }, { bId: id }] } });
		// Степени пересчитываем у всех: так починится и то, что разъехалось раньше.
		const all = await tx.user.findMany({ select: { id: true } });
		for (const row of all) {
			const degree = await tx.link.count({
				where: { OR: [{ aId: row.id }, { bId: row.id }] },
			});
			await tx.user.update({ where: { id: row.id }, data: { degree } });
		}
		await markLayoutDirty(tx);
	});

	console.log(`Развязано: ${links.length}. Раскладка пересчитается сама.`);
}

async function main(): Promise<void> {
	const [first, ...rest] = process.argv.slice(2);

	if (first === 'who') {
		await who();
	} else if (first && /^-?\d+$/.test(first)) {
		await unlinkAll(BigInt(first), rest.includes('--dry'));
	} else {
		console.log('Использование: unlinkAll.js <id> [--dry] | who');
		process.exitCode = 1;
	}
	await db.$disconnect();
}

main().catch(async (err: Error) => {
	console.error(`Не вышло: ${err.message}`);
	await db.$disconnect();
	process.exit(1);
});
