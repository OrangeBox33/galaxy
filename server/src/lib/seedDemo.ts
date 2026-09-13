// Демонстрационное небо: 80 тестовых пользователей с реалистичной структурой —
// три плотных комьюнити, два хаба-связки между ними и десяток одиночек
// (раздел 13). Нужен, чтобы оценить картинку глазами до прихода живых людей.
//
//   npm run seed:demo            добавить демо-звёзды
//   npm run seed:demo -- --wipe  сначала снести прежние тестовые
import { db } from '../db.js';
import { mulberry32 } from './prng.js';
import { normalizePair } from './pair.js';
import { recomputeLayout } from '../layout/runner.js';

const FIRST_NAMES_F = ['Аня','Марина','Лера','Оля','Катя','Настя','Даша','Ира','Юля','Соня','Вера','Лиза','Полина','Рита','Надя'];
const FIRST_NAMES_M = ['Никита','Паша','Дима','Серёга','Костя','Артём','Миша','Ваня','Лёха','Гриша','Фёдор','Тимур','Рома','Женя','Толя'];
const LAST_NAMES = ['Волков','Орлов','Зимин','Кедров','Морев','Лунин','Соколов','Быстров','Нилов','Гордеев','Шилов','Ясин'];

// Комьюнити: имя, размер, плотность связей внутри.
const COMMUNITIES = [
	{ name: 'универ', size: 26, density: 0.22 },
	{ name: 'работа', size: 22, density: 0.26 },
	{ name: 'двор', size: 20, density: 0.3 },
];
const BRIDGES = 2;
const LONERS = 10;

async function main(): Promise<void> {
	const wipe = process.argv.includes('--wipe');
	const random = mulberry32(0xde30a1);

	if (wipe) {
		const removed = await db.user.deleteMany({ where: { isTest: true } });
		console.log(`Снесено тестовых пользователей: ${removed.count}`);
	}

	// Свободный кусок отрицательного диапазона: тестовые id начинаются
	// с −1000000 и идут вниз.
	const lowest = await db.user.findFirst({
		where: { id: { lt: 0n } },
		orderBy: { id: 'asc' },
		select: { id: true },
	});
	let nextId = lowest === null ? -1000000n : lowest.id - 1n;

	type Person = { id: bigint; community: string };
	const people: Person[] = [];

	async function create(community: string): Promise<Person> {
		const female = random() < 0.5;
		const first = female
			? FIRST_NAMES_F[Math.floor(random() * FIRST_NAMES_F.length)]
			: FIRST_NAMES_M[Math.floor(random() * FIRST_NAMES_M.length)];
		const last = LAST_NAMES[Math.floor(random() * LAST_NAMES.length)];
		const id = nextId;
		nextId -= 1n;

		await db.user.create({
			data: {
				id,
				customName: `${first} ${last}${female ? 'а' : ''}`,
				gender: female ? 'FEMALE' : 'MALE',
				age: 18 + Math.floor(random() * 30),
				isTest: true,
			},
		});
		const person = { id, community };
		people.push(person);
		return person;
	}

	const pairs = new Set<string>();
	const links: { aId: bigint; bId: bigint }[] = [];

	function link(a: bigint, b: bigint): void {
		if (a === b) return;
		const [aId, bId] = normalizePair(a, b);
		const key = `${aId}-${bId}`;
		if (pairs.has(key)) return;
		pairs.add(key);
		links.push({ aId, bId });
	}

	// Комьюнити: внутри плотно, но не полный граф.
	const byCommunity = new Map<string, Person[]>();
	for (const community of COMMUNITIES) {
		const members: Person[] = [];
		for (let i = 0; i < community.size; i += 1) members.push(await create(community.name));
		byCommunity.set(community.name, members);

		for (let i = 0; i < members.length; i += 1) {
			for (let j = i + 1; j < members.length; j += 1) {
				if (random() < community.density) link(members[i].id, members[j].id);
			}
		}
		// Чтобы никто не остался в комьюнити без единой связи.
		for (let i = 1; i < members.length; i += 1) {
			link(members[i].id, members[Math.floor(random() * i)].id);
		}
	}

	// Хабы-связки: знают всех понемногу в каждом комьюнити.
	for (let b = 0; b < BRIDGES; b += 1) {
		const hub = await create('связка');
		for (const community of COMMUNITIES) {
			const members = byCommunity.get(community.name)!;
			const count = 5 + Math.floor(random() * 5);
			for (let i = 0; i < count; i += 1) {
				link(hub.id, members[Math.floor(random() * members.length)].id);
			}
		}
	}

	// Одиночки: одна связь или вовсе ни одной.
	for (let i = 0; i < LONERS; i += 1) {
		const loner = await create('одиночка');
		if (random() < 0.6) {
			const community = COMMUNITIES[Math.floor(random() * COMMUNITIES.length)];
			const members = byCommunity.get(community.name)!;
			link(loner.id, members[Math.floor(random() * members.length)].id);
		}
	}

	await db.link.createMany({ data: links, skipDuplicates: true });

	// Денормализованная степень пересчитывается вместе с раскладкой.
	const result = await recomputeLayout({ full: true });

	console.log(
		`Готово: ${people.length} звёзд, ${links.length} связей, ` +
			`раскладка версии ${result.version} за ${result.ms} мс`,
	);
	await db.$disconnect();
}

main().catch(async (err: Error) => {
	console.error(`Сид не отработал: ${err.message}`);
	await db.$disconnect();
	process.exit(1);
});
