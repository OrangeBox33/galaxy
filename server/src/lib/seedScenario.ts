// Заказанная картина для проверки раскладки глазами.
//
// Слои, по порядку появления:
//
//   1. Компания из 20 человек, и владелец среди них. Пятнадцать знают друг
//      друга все до одного, ещё пятеро знакомы примерно с половиной.
//   2. Отдельная компания из 8 человек, тоже все знают всех, с первой
//      двадцаткой не пересекается. Ровно один человек из неё знаком с двумя
//      из первой — единственный мостик между двумя мирами.
//   3. Каждый из первых двадцати приводит от нуля до пяти новых людей.
//      Новичок знаком с тем, кто его привёл, и с шансом 30% — с любым другим
//      из исходных двадцати.
//   4. Пятеро связных: каждый знает троих из второй компании и двоих из первой.
//   5. У каждого связного по пять знакомых, у которых больше нет вообще никого.
//
// Такая структура проверяет главное: два плотных комьюнити должны разойтись
// по разные стороны, мостик — натянуться между ними, разросшаяся периферия —
// лечь вокруг своей компании, а одиночки — уйти на самый край.
//
//   node server/src/lib/seedScenario.js [ваш telegram id]
import { db } from '../db.js';
import { randomFlame } from './flame.js';
import { env } from '../env.js';
import { mulberry32 } from '../../../shared/prng.js';
import { normalizePair } from './pair.js';
import { recomputeLayout } from '../layout/runner.js';

const CLIQUE = 15; // знают друг друга все
const FRINGE = 5; // знакомы с половиной
const OTHER = 8; // вторая компания
const BRIDGE_LINKS = 2; // столько знакомых у мостика в первой компании

const INVITED_MAX = 5; // сколько человек приводит каждый из первых двадцати
const INVITED_CROSS = 0.3; // шанс, что новичок знаком ещё с кем-то из двадцати

const CONNECTORS = 5; // связные между компаниями
const CONNECTOR_TO_OTHER = 3; // знакомых во второй компании
const CONNECTOR_TO_FIRST = 2; // знакомых в первой
const TAIL_PER_CONNECTOR = 5; // одиночки при каждом связном

const FEMALE = ['Аня','Марина','Лера','Оля','Катя','Настя','Даша','Ира','Юля','Соня','Вера','Лиза','Полина','Рита','Надя','Женя','Таня','Алла','Зина','Люба','Мила','Нина'];
const MALE = ['Никита','Паша','Дима','Серёга','Костя','Артём','Миша','Ваня','Лёха','Гриша','Фёдор','Тимур','Рома','Толя','Игорь','Борис','Влад','Егор','Семён','Пётр','Юра','Слава'];
const LAST = ['Волков','Орлов','Зимин','Кедров','Морев','Лунин','Соколов','Быстров','Нилов','Гордеев','Шилов','Ясин','Седов','Рогов','Тихонов','Белов','Мушкин','Заров'];

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

	let nextId = -1000000n;
	const created: {
		id: bigint;
		name: string;
		gender: 'MALE' | 'FEMALE';
		age: number;
		isTest: true;
	}[] = [];

	// Пользователей набираем списком и пишем одной пачкой: полторы сотни
	// отдельных вставок на слабом сервере заняли бы заметное время.
	function person(): bigint {
		const female = random() < 0.5;
		const pool = female ? FEMALE : MALE;
		const id = nextId;
		nextId -= 1n;
		created.push({
			id,
			name: `${pool[Math.floor(random() * pool.length)]} ${LAST[Math.floor(random() * LAST.length)]}${female ? 'а' : ''}`,
			gender: female ? 'FEMALE' : 'MALE',
			age: 20 + Math.floor(random() * 25),
			isTest: true,
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

	// Перемешивание с посеянным ГПСЧ: Array.sort со случайным компаратором
	// перемешивает неравномерно, поэтому берём честную тасовку Фишера—Йетса.
	function shuffled<T>(items: T[]): T[] {
		const copy = [...items];
		for (let i = copy.length - 1; i > 0; i -= 1) {
			const j = Math.floor(random() * (i + 1));
			[copy[i], copy[j]] = [copy[j], copy[i]];
		}
		return copy;
	}

	// ── 1. Первая компания ─────────────────────────────────────────────
	const core: bigint[] = [meId];
	for (let i = 1; i < CLIQUE; i += 1) core.push(person());
	for (let i = 0; i < core.length; i += 1) {
		for (let j = i + 1; j < core.length; j += 1) link(core[i], core[j]);
	}

	const half = Math.round(CLIQUE / 2);
	const fringe: bigint[] = [];
	for (let i = 0; i < FRINGE; i += 1) {
		const who = person();
		fringe.push(who);
		for (const neighbour of shuffled(core).slice(0, half)) link(who, neighbour);
	}

	// Эти двадцать и есть «первая компания».
	const first = [...core, ...fringe];

	// ── 2. Вторая компания и мостик ────────────────────────────────────
	const other: bigint[] = [];
	for (let i = 0; i < OTHER; i += 1) other.push(person());
	for (let i = 0; i < other.length; i += 1) {
		for (let j = i + 1; j < other.length; j += 1) link(other[i], other[j]);
	}
	for (const neighbour of shuffled(fringe).slice(0, BRIDGE_LINKS)) link(other[0], neighbour);

	// ── 3. Кого привели первые двадцать ────────────────────────────────
	const invited: bigint[] = [];
	for (const host of first) {
		const count = Math.floor(random() * (INVITED_MAX + 1)); // 0..5
		for (let i = 0; i < count; i += 1) {
			const guest = person();
			invited.push(guest);
			link(guest, host);

			// Новичок мог уже знать кого-то ещё из этой компании.
			for (const member of first) {
				if (member !== host && random() < INVITED_CROSS) link(guest, member);
			}
		}
	}

	// ── 4. Связные между компаниями ────────────────────────────────────
	const connectors: bigint[] = [];
	for (let i = 0; i < CONNECTORS; i += 1) {
		const who = person();
		connectors.push(who);
		for (const neighbour of shuffled(other).slice(0, CONNECTOR_TO_OTHER)) link(who, neighbour);
		for (const neighbour of shuffled(first).slice(0, CONNECTOR_TO_FIRST)) link(who, neighbour);
	}

	// ── 5. Хвост одиночек ──────────────────────────────────────────────
	// У каждого ровно одна связь — со своим связным. На карте они окажутся
	// у самого края: дальше от центра только те, у кого нет никого.
	let tail = 0;
	for (const connector of connectors) {
		for (let i = 0; i < TAIL_PER_CONNECTOR; i += 1) {
			link(person(), connector);
			tail += 1;
		}
	}

	await db.user.createMany({
		data: created.map((row) => ({
			id: row.id,
			customName: row.name,
			gender: row.gender,
			flame: randomFlame(),
			age: row.age,
			isTest: row.isTest,
		})),
	});
	await db.link.createMany({ data: links, skipDuplicates: true });

	const result = await recomputeLayout({ full: true });
	console.log(
		[
			`Первая компания: ${CLIQUE} в клике (вы среди них) + ${FRINGE} с краю`,
			`Вторая компания: ${OTHER}, мостик один`,
			`Приведённые: ${invited.length}`,
			`Связные: ${connectors.length}, одиночек при них: ${tail}`,
			`Всего: ${created.length + 1} человек, ${links.length} связей`,
			`Раскладка версии ${result.version} за ${result.ms} мс`,
		].join('\n'),
	);
	await db.$disconnect();
}

main().catch(async (err: Error) => {
	console.error(`Не вышло: ${err.message}`);
	await db.$disconnect();
	process.exit(1);
});
