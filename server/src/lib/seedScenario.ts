// Заказанная картина для проверки раскладки глазами:
//
//   • компания из 20 человек, и вы среди них. Пятнадцать знают друг друга все
//     до одного, ещё пятеро знакомы примерно с половиной компании;
//   • отдельная компания из 8 человек, тоже все знают всех, но с первой
//     двадцаткой не пересекается;
//   • ровно один человек из второй компании знаком с двумя из первой —
//     единственный мостик между двумя мирами.
//
// Именно такая структура и проверяет главное обещание раскладки: два плотных
// комьюнити должны разойтись по разные стороны, мостик — натянуться между ними,
// а вы — оказаться в гуще своей компании.
//
//   node server/src/lib/seedScenario.js [ваш telegram id]
import { db } from '../db.js';
import { env } from '../env.js';
import { mulberry32 } from '../../../shared/prng.js';
import { normalizePair } from './pair.js';
import { recomputeLayout } from '../layout/runner.js';

const CLIQUE = 15; // знают друг друга все
const FRINGE = 5; // знакомы с половиной
const OTHER = 8; // вторая компания
const BRIDGE_LINKS = 2; // столько знакомых у мостика в первой компании

const FEMALE = ['Аня','Марина','Лера','Оля','Катя','Настя','Даша','Ира','Юля','Соня','Вера','Лиза','Полина','Рита','Надя','Женя','Таня'];
const MALE = ['Никита','Паша','Дима','Серёга','Костя','Артём','Миша','Ваня','Лёха','Гриша','Фёдор','Тимур','Рома','Толя','Игорь','Борис','Влад'];
const LAST = ['Волков','Орлов','Зимин','Кедров','Морев','Лунин','Соколов','Быстров','Нилов','Гордеев','Шилов','Ясин','Седов','Рогов'];

async function main(): Promise<void> {
	const meId = process.argv[2] ? BigInt(process.argv[2]) : env.adminIds[0];
	const me = await db.user.findUnique({ where: { id: meId } });
	if (!me) {
		throw new Error(`пользователя ${meId} нет в базе — сначала зайдите в приложение`);
	}

	const random = mulberry32(0x5ce9a1);

	// Тестовых сносим целиком: их связи уйдут каскадом, включая связи с вами.
	const removed = await db.user.deleteMany({ where: { isTest: true } });
	console.log(`Снесено прежних тестовых: ${removed.count}`);

	const lowest = await db.user.findFirst({
		where: { id: { lt: 0n } },
		orderBy: { id: 'asc' },
		select: { id: true },
	});
	let nextId = lowest === null ? -1000000n : lowest.id - 1n;

	async function create(): Promise<bigint> {
		const female = random() < 0.5;
		const pool = female ? FEMALE : MALE;
		const first = pool[Math.floor(random() * pool.length)];
		const last = LAST[Math.floor(random() * LAST.length)];
		const id = nextId;
		nextId -= 1n;

		await db.user.create({
			data: {
				id,
				customName: `${first} ${last}${female ? 'а' : ''}`,
				gender: female ? 'FEMALE' : 'MALE',
				age: 20 + Math.floor(random() * 25),
				isTest: true,
			},
		});
		return id;
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

	// ── Первая компания ────────────────────────────────────────────────
	// Ядро: пятнадцать человек, где вы — один из них.
	const core: bigint[] = [meId];
	for (let i = 1; i < CLIQUE; i += 1) core.push(await create());
	for (let i = 0; i < core.length; i += 1) {
		for (let j = i + 1; j < core.length; j += 1) link(core[i], core[j]);
	}

	// Пятеро с краю: каждый знаком с половиной ядра. Кого именно — тасуем,
	// иначе все пятеро прилипнут к одним и тем же людям.
	const half = Math.round(CLIQUE / 2);
	const fringe: bigint[] = [];
	for (let i = 0; i < FRINGE; i += 1) {
		const person = await create();
		fringe.push(person);

		const shuffled = [...core].sort(() => random() - 0.5);
		for (const neighbour of shuffled.slice(0, half)) link(person, neighbour);
	}

	// ── Вторая компания ────────────────────────────────────────────────
	const other: bigint[] = [];
	for (let i = 0; i < OTHER; i += 1) other.push(await create());
	for (let i = 0; i < other.length; i += 1) {
		for (let j = i + 1; j < other.length; j += 1) link(other[i], other[j]);
	}

	// ── Мостик ─────────────────────────────────────────────────────────
	// Один человек из второй компании знаком с двумя из первой.
	// Берём его знакомых из тех, кто с краю: так мостик не будет тянуться
	// прямо в середину чужого комьюнити.
	const bridge = other[0];
	const shuffledFringe = [...fringe].sort(() => random() - 0.5);
	for (const neighbour of shuffledFringe.slice(0, BRIDGE_LINKS)) link(bridge, neighbour);

	await db.link.createMany({ data: links, skipDuplicates: true });

	const result = await recomputeLayout({ full: true });
	console.log(
		`Готово: ${CLIQUE + FRINGE + OTHER} человек (вы среди пятнадцати), ` +
			`${links.length} связей, раскладка версии ${result.version} за ${result.ms} мс`,
	);
	await db.$disconnect();
}

main().catch(async (err: Error) => {
	console.error(`Не вышло: ${err.message}`);
	await db.$disconnect();
	process.exit(1);
});
