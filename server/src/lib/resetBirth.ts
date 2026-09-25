// Показать рождение звезды заново: инструмент для опытов, не часть приложения.
//   node server/src/lib/resetBirth.js <id>          сбросить флаг одному
//   node server/src/lib/resetBirth.js all           всем сразу
//   node server/src/lib/resetBirth.js <id> --place  заодно забыть место звезды
//
// С --place звезда при следующем входе сядет заново, но до этого входа она
// стоит в нуле — в самой середине неба, и пересчёт её оттуда не уводит.
import { db } from '../db.js';
import { displayName } from './names.js';

async function reset(id: bigint | null, place: boolean): Promise<void> {
	const where = id === null ? {} : { id };
	const users = await db.user.findMany({ where, orderBy: { id: 'asc' } });
	if (users.length === 0) throw new Error(id === null ? 'Ни одного человека' : `Нет такого: ${id}`);

	await db.user.updateMany({
		where,
		data: { bornSeen: false, ...(place ? { x: 0, y: 0 } : {}) },
	});

	for (const user of users) {
		console.log(`${user.id.toString().padEnd(14)} ${displayName(user)}`);
	}
	console.log(
		`Рождение снова покажется: ${users.length}` + (place ? '; место забыто' : '; место прежнее'),
	);
}

async function main(): Promise<void> {
	const [first, ...rest] = process.argv.slice(2);
	const place = rest.includes('--place');

	if (first === 'all') {
		await reset(null, place);
	} else if (first && /^-?\d+$/.test(first)) {
		await reset(BigInt(first), place);
	} else {
		console.log('Использование: resetBirth.js <id> | all [--place]');
		process.exitCode = 1;
	}
	await db.$disconnect();
}

main().catch(async (err: Error) => {
	console.error(`Не вышло: ${err.message}`);
	await db.$disconnect();
	process.exit(1);
});
