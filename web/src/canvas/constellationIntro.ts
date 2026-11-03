// Как созвездия проявляются на входе в приложение. Подбирается в песочнице
// рождения (web/birth.html).
import { clamp01, easeInOutCubic } from './animate';

export type IntroMode = 'fade' | 'wave' | 'lightning';
// Откуда бежит молния: от меня (в чужих созвездиях — от нижней звезды) или со случайной.
export type IntroRoot = 'bottom' | 'random';
// Скорость молнии: постоянная по небу или одно и то же время на каждую линию.
export type IntroPace = 'distance' | 'hops';

export const introTuning = {
	mode: 'lightning' as IntroMode,
	root: 'random' as IntroRoot,
	pace: 'distance' as IntroPace,
	delay: 500, // мс чистого неба до первой линии
	// Первая молния — пробегающая искра: каждая линия вспыхивает и за firstFade мс
	// гаснет до нуля, целиком дерево не видно ни в один миг. Потом dark мс без линий.
	// firstDuration 0 — сразу основная.
	firstDuration: 250,
	firstFlash: 2,
	firstFade: 100,
	dark: 1000,
	duration: 5000, // мс
	flash: 4, // насколько ярче обычного только что зажжённая линия
	afterglow: 800, // мс, за которые вспышка гаснет до обычной яркости в e раз
};

// Доля проведённой линии — от конца from; boost — надбавка к яркости поверх обычной,
// alpha — множитель яркости (у «разом»).
export type Reveal = { fromA: boolean; fraction: number; boost: number; alpha: number };

export type IntroPlan = Map<string, { start: number; end: number; fromA: boolean }>;

type PlanPoint = { id: string; x: number; y: number };
type PlanLine = { key: string; a: PlanPoint; b: PlanPoint };

const FULL: Reveal = { fromA: true, fraction: 1, boost: 0, alpha: 1 };
const DARK: Reveal = { fromA: true, fraction: 0, boost: 0, alpha: 0 };

// fadeOut — линия гаснет до нуля линейно за afterglow; иначе вспышка спадает
// к обычной яркости, в e раз за afterglow, и за четыре таких срока её уже не видно.
type Pass = { duration: number; flash: number; afterglow: number; fadeOut: boolean };

const passLength = (pass: Pass) => pass.duration + pass.afterglow * (pass.fadeOut ? 1 : 4);

function firstPass(): Pass {
	const { firstDuration, firstFlash, firstFade } = introTuning;
	return { duration: firstDuration, flash: firstFlash, afterglow: firstFade, fadeOut: true };
}

function mainStart(): number {
	return introTuning.firstDuration > 0 ? passLength(firstPass()) + introTuning.dark : 0;
}

function mainPass(): Pass {
	const { duration, flash, afterglow } = introTuning;
	return { duration, flash, afterglow, fadeOut: false };
}

export function introOver(elapsed: number): boolean {
	return elapsed >= mainStart() + passLength(mainPass());
}

// Какой проход идёт и сколько мс от его начала; null — темнота между проходами.
function passAt(elapsed: number): { pass: Pass; local: number } | null {
	const start = mainStart();
	if (elapsed >= start) return { pass: mainPass(), local: elapsed - start };
	return elapsed < passLength(firstPass()) ? { pass: firstPass(), local: elapsed } : null;
}

// Молния бежит по дереву созвездия от корня: время, когда линия зажигается, — её
// путь от корня по самим линиям, в длинах или в числе линий. Все созвездия
// стартуют разом, самое длинное как раз укладывается в duration.
export function lightningPlan(lines: PlanLine[], root: string | null): IntroPlan {
	const adjacent = new Map<string, { other: string; length: number }[]>();
	const points = new Map<string, PlanPoint>();
	const length = (line: PlanLine) =>
		introTuning.pace === 'hops' ? 1 : Math.hypot(line.a.x - line.b.x, line.a.y - line.b.y);
	for (const line of lines) {
		points.set(line.a.id, line.a);
		points.set(line.b.id, line.b);
		const size = length(line);
		adjacent.set(line.a.id, [
			...(adjacent.get(line.a.id) ?? []),
			{ other: line.b.id, length: size },
		]);
		adjacent.set(line.b.id, [
			...(adjacent.get(line.b.id) ?? []),
			{ other: line.a.id, length: size },
		]);
	}

	// Корнем созвездия становится первая его звезда в этом порядке.
	const order = [...points.values()]
		.map((point) => ({ point, luck: Math.random() }))
		.sort(({ point: p, luck: lp }, { point: q, luck: lq }) =>
			introTuning.root === 'random'
				? lp - lq
				: p.id === root
					? -1
					: q.id === root
						? 1
						: q.y - p.y || (p.id < q.id ? -1 : 1),
		)
		.map(({ point }) => point.id);

	const distance = new Map<string, number>();
	for (const start of order) {
		if (distance.has(start)) continue;
		distance.set(start, 0);
		const queue = [start];
		while (queue.length > 0) {
			queue.sort((p, q) => distance.get(p)! - distance.get(q)!);
			const id = queue.shift()!;
			for (const { other, length: size } of adjacent.get(id) ?? []) {
				const next = distance.get(id)! + size;
				if (distance.has(other) && distance.get(other)! <= next) continue;
				distance.set(other, next);
				queue.push(other);
			}
		}
	}

	const plan: IntroPlan = new Map();
	let longest = 0;
	for (const line of lines) {
		const fromA = distance.get(line.a.id)! <= distance.get(line.b.id)!;
		const start = Math.min(distance.get(line.a.id)!, distance.get(line.b.id)!);
		const end = start + length(line);
		longest = Math.max(longest, end);
		plan.set(line.key, { start, end, fromA });
	}
	for (const step of plan.values()) {
		step.start /= longest || 1;
		step.end /= longest || 1;
	}
	return plan;
}

// a и b — экранные точки концов, elapsed — мс от начала проявления. Оба прохода
// идут по одному плану: вторая молния бежит тем же путём, что первая.
export function revealLine(
	key: string,
	a: { sy: number },
	b: { sy: number },
	height: number,
	elapsed: number,
	plan: IntroPlan | null,
): Reveal {
	if (introOver(elapsed)) return FULL;
	const current = passAt(elapsed);
	if (!current) return DARK;
	const { duration, flash, afterglow, fadeOut } = current.pass;
	const p = current.local / Math.max(1, duration);
	// past — мс с тех пор, как линия проведена целиком.
	const shine = (past: number) =>
		fadeOut
			? { boost: flash, alpha: past <= 0 ? 1 : clamp01(1 - past / Math.max(1, afterglow)) }
			: {
					boost: past <= 0 ? flash : flash * Math.exp(-past / Math.max(1, afterglow)),
					alpha: 1,
				};

	if (introTuning.mode === 'fade') {
		const alpha = easeInOutCubic(clamp01(p)) * shine((p - 1) * duration).alpha;
		return { fromA: true, fraction: 1, boost: 0, alpha };
	}

	if (introTuning.mode === 'wave') {
		// Волна по экрану, а не по небу: «снизу вверх» — это про то, что видит человек.
		const fromA = a.sy >= b.sy;
		const low = fromA ? a.sy : b.sy;
		const high = fromA ? b.sy : a.sy;
		const front = height * (1 - p);
		const fraction = low > high ? clamp01((low - front) / (low - high)) : front <= low ? 1 : 0;
		return { fromA, fraction, ...shine(((high - front) / height) * duration) };
	}

	const step = plan?.get(key);
	if (!step) return FULL;
	const fraction =
		step.end > step.start
			? clamp01((p - step.start) / (step.end - step.start))
			: p >= step.start
				? 1
				: 0;
	return { fromA: step.fromA, fraction, ...shine((p - step.end) * duration) };
}
