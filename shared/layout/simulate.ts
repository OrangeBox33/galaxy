// Симуляция звёздной системы (раздел 7.2–7.5). Три силы: радиальная привязка
// к целевой орбите, кулоновское отталкивание и пружины на рёбрах.
// Центр C зафиксирован в (0,0) на всё время симуляции.
import { LAYOUT_PARAMS as P, starRadius } from './params.js';

export type SimNode = {
	id: bigint;
	degree: number;
	centrality: number;
	mass: number; // m = 1 + deg
	target: number; // r_target
	radius: number; // видимый радиус, нужен для разведения
	x: number;
	y: number;
	vx: number;
	vy: number;
};

export function makeNode(id: bigint, degree: number, centrality: number): SimNode {
	return {
		id,
		degree,
		centrality,
		mass: 1 + degree,
		// Показатель 0.5 даёт равномерную плотность звёзд по площади: без него
		// периферия разрежена, а центр слипается.
		target: P.R_MAX * Math.sqrt(Math.max(0, 1 - centrality)),
		radius: starRadius(degree),
		x: 0,
		y: 0,
		vx: 0,
		vy: 0,
	};
}

// Первичная раскладка: подсолнух по золотому углу. Узлы, отсортированные
// по ĉ по убыванию, ложатся от центра к краю, поэтому хабы сразу оказываются
// в середине и симуляция сходится за считанные сотни итераций.
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

export function sunflowerPosition(index: number, total: number): { x: number; y: number } {
	const radius = P.R_MAX * Math.sqrt((index + 0.5) / Math.max(1, total));
	const angle = index * GOLDEN_ANGLE;
	return { x: radius * Math.cos(angle), y: radius * Math.sin(angle) };
}

export type SimulateOptions = {
	alpha: number;
	iterations: number;
	// Охлаждение можно переопределить: это нужно для подбора коэффициентов
	// на реальных данных, в обычной работе берётся из params.ts.
	cooling?: number;
};

export function simulate(
	nodes: SimNode[],
	edges: [number, number][],
	options: SimulateOptions,
): void {
	const n = nodes.length;
	if (n === 0) return;

	const fx = new Float64Array(n);
	const fy = new Float64Array(n);
	let alpha = options.alpha;
	const cooling = options.cooling ?? P.COOLING;

	for (let step = 0; step < options.iterations; step += 1) {
		fx.fill(0);
		fy.fill(0);

		// Радиальная привязка: F = −K_RAD · m · (|p − C| − r_target) · û
		for (let i = 0; i < n; i += 1) {
			const node = nodes[i];
			const dist = Math.hypot(node.x, node.y);
			if (dist < 1e-9) continue;
			const pull = -P.K_RAD * node.mass * (dist - node.target);
			fx[i] += (pull * node.x) / dist;
			fy[i] += (pull * node.y) / dist;
		}

		// Отталкивание по всем парам. D_MIN не даёт силе взорваться,
		// когда две звезды оказались в одной точке.
		for (let i = 0; i < n; i += 1) {
			for (let j = i + 1; j < n; j += 1) {
				let dx = nodes[i].x - nodes[j].x;
				let dy = nodes[i].y - nodes[j].y;
				let distSq = dx * dx + dy * dy;
				if (distSq < 1e-12) {
					// Полное совпадение координат: разводим детерминированно,
					// чтобы результат не зависел от порядка вызовов.
					dx = 1e-6 * (i + 1);
					dy = 1e-6 * (j + 1);
					distSq = dx * dx + dy * dy;
				}
				const dist = Math.sqrt(distSq);
				const denom = Math.max(distSq, P.D_MIN * P.D_MIN);
				const force = (P.K_REP * nodes[i].mass * nodes[j].mass) / denom;
				const ux = dx / dist;
				const uy = dy / dist;
				fx[i] += force * ux;
				fy[i] += force * uy;
				fx[j] -= force * ux;
				fy[j] -= force * uy;
			}
		}

		// Пружины на рёбрах. Длина покоя растёт с массами концов — так у хабов
		// остаётся пространство вокруг себя.
		for (const [a, b] of edges) {
			const dx = nodes[a].x - nodes[b].x;
			const dy = nodes[a].y - nodes[b].y;
			const dist = Math.hypot(dx, dy);
			if (dist < 1e-9) continue;
			const rest =
				P.L0 * (1 + P.L_MASS * (Math.sqrt(nodes[a].mass) + Math.sqrt(nodes[b].mass)));
			const force = -P.K_SPR * (dist - rest);
			const ux = dx / dist;
			const uy = dy / dist;
			fx[a] += force * ux;
			fy[a] += force * uy;
			fx[b] -= force * ux;
			fy[b] -= force * uy;
		}

		// Полуявный Эйлер с охлаждением. Деление на массу — тяжёлые узлы инертны,
		// мелочь крутится вокруг них: это и даёт ощущение звёздной системы.
		for (let i = 0; i < n; i += 1) {
			const node = nodes[i];
			node.vx = (node.vx + (fx[i] / node.mass) * P.DT) * P.DAMPING;
			node.vy = (node.vy + (fy[i] / node.mass) * P.DT) * P.DAMPING;
			node.x += node.vx * alpha;
			node.y += node.vy * alpha;
		}

		separate(nodes);
		removeDrift(nodes);

		alpha *= cooling;
		if (alpha < P.ALPHA_MIN) break;
	}
}

// Снятие общего сноса: после каждого шага возвращаем взвешенный по массам
// центроид в (0,0). Без этого система как целое уезжает в сторону, и шаг
// нормализации (7.7.1) потом рывком тащит её обратно — а следующая симуляция
// опять уводит. Центр C по ТЗ зафиксирован в (0,0), и центр масс обязан
// совпадать с ним, иначе «общий центр масс остаётся в центре экрана» неверно.
function removeDrift(nodes: SimNode[]): void {
	let sumX = 0;
	let sumY = 0;
	let sumMass = 0;
	for (const node of nodes) {
		sumX += node.x * node.mass;
		sumY += node.y * node.mass;
		sumMass += node.mass;
	}
	if (sumMass === 0) return;
	const cx = sumX / sumMass;
	const cy = sumY / sumMass;
	for (const node of nodes) {
		node.x -= cx;
		node.y -= cy;
	}
}

// Жёсткое разведение: если звёзды налезли друг на друга, раздвигаем их
// обратно пропорционально массам (при равных массах — поровну).
function separate(nodes: SimNode[]): void {
	const n = nodes.length;
	for (let i = 0; i < n; i += 1) {
		for (let j = i + 1; j < n; j += 1) {
			const a = nodes[i];
			const b = nodes[j];
			const minDist = a.radius + b.radius + P.SEPARATION_GAP;
			let dx = a.x - b.x;
			let dy = a.y - b.y;
			let dist = Math.hypot(dx, dy);
			if (dist >= minDist) continue;
			if (dist < 1e-9) {
				dx = 1e-6 * (i + 1);
				dy = 1e-6 * (j + 1);
				dist = Math.hypot(dx, dy);
			}
			const deficit = minDist - dist;
			const ux = dx / dist;
			const uy = dy / dist;
			// Доля смещения обратна массе: тяжёлый узел уступает меньше.
			const shareA = (1 / a.mass) / (1 / a.mass + 1 / b.mass);
			const shareB = 1 - shareA;
			a.x += ux * deficit * shareA;
			a.y += uy * deficit * shareA;
			b.x -= ux * deficit * shareB;
			b.y -= uy * deficit * shareB;
		}
	}
}
