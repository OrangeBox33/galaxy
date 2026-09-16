// Симуляция звёздной системы (раздел 7.2–7.5). Центр C зафиксирован в (0,0).
import { findClusters, type Clusters } from './clusters.js';
import {
	LAYOUT_PARAMS,
	resolveParams,
	starRadius,
	type LayoutOverrides,
	type LayoutParams,
} from './params.js';

export type SimNode = {
	id: bigint;
	degree: number;
	centrality: number;
	mass: number;
	target: number;
	radius: number;
	x: number;
	y: number;
	vx: number;
	vy: number;
};

export function makeNode(
	id: bigint,
	degree: number,
	centrality: number,
): SimNode {
	return {
		id,
		degree,
		centrality,
		mass: 1 + degree,
		// Персональных орбит по центральности нет: они растаскивают соседей
		// по компании через всё небо. Глобально — только удержание в кадре.
		target: 0,
		radius: starRadius(degree),
		x: 0,
		y: 0,
		vx: 0,
		vy: 0,
	};
}

// Численная механика, а не настройка вида: эти числа не дают формулам
// взорваться, и в панель песочницы они намеренно не выведены.
const DT = 1;
// Ближе этого отталкивание не растёт: иначе на нулевом расстоянии оно
// обращается в бесконечность.
const D_MIN = 14;
const GROUP_D_MIN = 120;
// Насколько связи удлиняют пружину у звезды с их большим числом.
const L_MASS = 0.18;
const SEPARATION_GAP = 6;
// Потолок проходов label propagation: обычно сходится за пять-шесть.
const CLUSTER_ITERATIONS = 24;

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

export function sunflowerPosition(
	index: number,
	total: number,
	params: LayoutParams = LAYOUT_PARAMS,
): { x: number; y: number } {
	const radius = params.R_MAX * Math.sqrt((index + 0.5) / Math.max(1, total));
	const angle = index * GOLDEN_ANGLE;
	return { x: radius * Math.cos(angle), y: radius * Math.sin(angle) };
}

export function buildNeighbours(count: number, edges: [number, number][]): number[][] {
	const neighbours: number[][] = Array.from({ length: count }, () => []);
	for (const [a, b] of edges) {
		neighbours[a].push(b);
		neighbours[b].push(a);
	}
	return neighbours;
}

export type SimulateOptions = {
	alpha: number;
	iterations: number;
	cooling?: number;
	params?: LayoutOverrides;
	// Готовые соседи и сообщества: index.ts их уже посчитал, незачем дважды.
	neighbours?: number[][];
	clusters?: Clusters;
};

export function simulate(
	nodes: SimNode[],
	edges: [number, number][],
	options: SimulateOptions,
): void {
	const n = nodes.length;
	if (n === 0) return;

	const P = resolveParams(options.params);
	const neighbours = options.neighbours ?? buildNeighbours(n, edges);
	const clusters = options.clusters ?? findClusters(neighbours, CLUSTER_ITERATIONS);
	const { component } = clusters;

	const { group, groupCount, groupSize, localCentrality } = clusters;

	// Орбита компании: суперкластер (доля 1) — в середину, одиночка (доля
	// около нуля) — к краю неба. Не ранговая шкала, а именно доля: ранг
	// у единственной компании был бы нулевым, и она уехала бы на край.
	const maxSize = Math.max(1, ...groupSize);
	const groupTarget = Array.from({ length: groupCount }, (_, g) =>
		P.R_MAX * Math.sqrt(Math.max(0, 1 - groupSize[g] / maxSize)),
	);

	// Расстояние до середины своей компании: кто знает в ней всех — в середину,
	// кто с краю — на край.
	const localTarget = nodes.map(
		(_, i) =>
			P.R_MAX *
			P.LOCAL_SPAN *
			Math.sqrt(groupSize[group[i]] / maxSize) *
			Math.sqrt(Math.max(0, 1 - localCentrality[i])),
	);

	// Центроиды компаний пересчитываются каждую итерацию: O(n) на проход,
	// против O(n²) отталкивания это ничто.
	const gx = new Float64Array(groupCount);
	const gy = new Float64Array(groupCount);
	const gm = new Float64Array(groupCount);
	// Ускорение, накопленное компанией за проход по парам компаний: раздаётся
	// участникам одним проходом, иначе вышло бы O(k²·n) вместо O(k²+n).
	const gax = new Float64Array(groupCount);
	const gay = new Float64Array(groupCount);

	const fx = new Float64Array(n);
	const fy = new Float64Array(n);
	let alpha = options.alpha;
	const cooling = options.cooling ?? P.COOLING;

	// Удержание в кадре, ослабленное по числу связей: хаба держат его же связи.
	const radialK = nodes.map((node) => P.K_RAD * node.mass ** -P.RAD_DEGREE_FADE);

	// Множитель mass компенсирует деление на массу в интеграторе: ускорение
	// должно зависеть только от степени, а не от неё дважды.
	const centroidK = nodes.map((node, i) =>
		neighbours[i].length === 0
			? 0
			: P.K_CENTROID * node.degree ** -P.CENTROID_DEGREE_FADE * node.mass,
	);

	for (let step = 0; step < options.iterations; step += 1) {
		fx.fill(0);
		fy.fill(0);

		for (let i = 0; i < n; i += 1) {
			const node = nodes[i];
			const dist = Math.hypot(node.x, node.y);
			if (dist < 1e-9) continue;
			const pull = -radialK[i] * node.mass * (dist - node.target);
			fx[i] += (pull * node.x) / dist;
			fy[i] += (pull * node.y) / dist;
		}

		gx.fill(0);
		gy.fill(0);
		gm.fill(0);
		for (let i = 0; i < n; i += 1) {
			const g = group[i];
			const m = nodes[i].mass;
			gx[g] += nodes[i].x * m;
			gy[g] += nodes[i].y * m;
			gm[g] += m;
		}
		for (let g = 0; g < groupCount; g += 1) {
			if (gm[g] === 0) continue;
			gx[g] /= gm[g];
			gy[g] /= gm[g];
		}

		if (P.K_LOCAL !== 0) {
			for (let i = 0; i < n; i += 1) {
				const g = group[i];
				if (groupSize[g] < 2) continue;
				const dx = nodes[i].x - gx[g];
				const dy = nodes[i].y - gy[g];
				const dist = Math.hypot(dx, dy);
				if (dist < 1e-9) continue;
				const pull = -P.K_LOCAL * nodes[i].mass * (dist - localTarget[i]);
				fx[i] += (pull * dx) / dist;
				fy[i] += (pull * dy) / dist;
			}
		}

		if (P.K_GROUP_RAD !== 0) {
			for (let i = 0; i < n; i += 1) {
				const g = group[i];
				const dist = Math.hypot(gx[g], gy[g]);
				if (dist < 1e-9) continue;
				const accel = (-P.K_GROUP_RAD * (dist - groupTarget[g])) / dist;
				fx[i] += accel * gx[g] * nodes[i].mass;
				fy[i] += accel * gy[g] * nodes[i].mass;
			}
		}

		// Компании расталкиваются как целые: сила одинакова для всех участников
		// компании, поэтому зазора между звёздами внутри неё она не трогает.
		if (P.K_GROUP_REP !== 0 && groupCount > 1) {
			gax.fill(0);
			gay.fill(0);
			for (let a = 0; a < groupCount; a += 1) {
				for (let b = a + 1; b < groupCount; b += 1) {
					let dx = gx[a] - gx[b];
					let dy = gy[a] - gy[b];
					let distSq = dx * dx + dy * dy;
					if (distSq < 1e-12) {
						dx = 1e-6 * (a + 1);
						dy = 1e-6 * (b + 1);
						distSq = dx * dx + dy * dy;
					}
					const dist = Math.sqrt(distSq);
					const denom = Math.max(distSq, GROUP_D_MIN * GROUP_D_MIN);
					const ux = dx / dist;
					const uy = dy / dist;
					const accelA = (P.K_GROUP_REP * groupSize[b]) / denom;
					const accelB = (P.K_GROUP_REP * groupSize[a]) / denom;
					gax[a] += accelA * ux;
					gay[a] += accelA * uy;
					gax[b] -= accelB * ux;
					gay[b] -= accelB * uy;
				}
			}
			for (let i = 0; i < n; i += 1) {
				const g = group[i];
				// Ускорение, а не сила: умножаем на массу участника, чтобы
				// интегратор её же и сократил и компания поехала целиком.
				fx[i] += gax[g] * nodes[i].mass;
				fy[i] += gay[g] * nodes[i].mass;
			}
		}

		if (P.K_CENTROID !== 0) {
			for (let i = 0; i < n; i += 1) {
				const list = neighbours[i];
				if (list.length === 0) continue;
				let cx = 0;
				let cy = 0;
				for (const j of list) {
					cx += nodes[j].x;
					cy += nodes[j].y;
				}
				cx /= list.length;
				cy /= list.length;
				fx[i] += centroidK[i] * (cx - nodes[i].x);
				fy[i] += centroidK[i] * (cy - nodes[i].y);
			}
		}

		for (let i = 0; i < n; i += 1) {
			for (let j = i + 1; j < n; j += 1) {
				let dx = nodes[i].x - nodes[j].x;
				let dy = nodes[i].y - nodes[j].y;
				let distSq = dx * dx + dy * dy;
				if (distSq < 1e-12) {
					// Разводим детерминированно: результат не должен зависеть
					// от порядка вызовов.
					dx = 1e-6 * (i + 1);
					dy = 1e-6 * (j + 1);
					distSq = dx * dx + dy * dy;
				}
				const dist = Math.sqrt(distSq);
				const denom = Math.max(distSq, D_MIN * D_MIN);
				// Компонента, а не компания: компании внутри одной компоненты
				// разводит K_GROUP_REP, второй надбавки им не надо.
				const apart = component[i] !== component[j] ? P.REP_COMPONENT : 1;
				const force = (P.K_REP * apart * nodes[i].mass * nodes[j].mass) / denom;
				const ux = dx / dist;
				const uy = dy / dist;
				fx[i] += force * ux;
				fy[i] += force * uy;
				fx[j] -= force * ux;
				fy[j] -= force * uy;
			}
		}

		for (const [a, b] of edges) {
			const dx = nodes[a].x - nodes[b].x;
			const dy = nodes[a].y - nodes[b].y;
			const dist = Math.hypot(dx, dy);
			if (dist < 1e-9) continue;
			const rest =
				P.L0 * (1 + L_MASS * (Math.sqrt(nodes[a].mass) + Math.sqrt(nodes[b].mass)));
			const force = -P.K_SPR * (dist - rest);
			const ux = dx / dist;
			const uy = dy / dist;
			fx[a] += force * ux;
			fy[a] += force * uy;
			fx[b] -= force * ux;
			fy[b] -= force * uy;
		}

		for (let i = 0; i < n; i += 1) {
			const node = nodes[i];
			node.vx = (node.vx + (fx[i] / node.mass) * DT) * P.DAMPING;
			node.vy = (node.vy + (fy[i] / node.mass) * DT) * P.DAMPING;
			node.x += node.vx * alpha;
			node.y += node.vy * alpha;
		}

		separate(nodes, P);
		removeDrift(nodes);

		alpha *= cooling;
		if (alpha < P.ALPHA_MIN) break;
	}
}

// Без снятия сноса система уезжает целиком, нормализация рывком тащит её
// обратно, а следующая симуляция уводит снова. Центр неба — (0,0), и центр
// масс обязан с ним совпадать.
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

function separate(nodes: SimNode[], params: LayoutParams): void {
	const n = nodes.length;
	for (let i = 0; i < n; i += 1) {
		for (let j = i + 1; j < n; j += 1) {
			const a = nodes[i];
			const b = nodes[j];
			const minDist = a.radius + b.radius + SEPARATION_GAP;
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
			const shareA = (1 / a.mass) / (1 / a.mass + 1 / b.mass);
			const shareB = 1 - shareA;
			a.x += ux * deficit * shareA;
			a.y += uy * deficit * shareA;
			b.x -= ux * deficit * shareB;
			b.y -= uy * deficit * shareB;
		}
	}
}
