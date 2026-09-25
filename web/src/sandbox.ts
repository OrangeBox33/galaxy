// Отладочная страница /galaxy/sandbox.html: в сборку не попадает.
// Вид звезды по числу связей: ряд от одиночки до гиганта на 150, с соседями
// 24 и 25 — на них приходится порог начала языка и надбавки к ширине.
import { createRenderer } from './canvas/renderer';
import { createPanel, sandboxColors } from './panel';
import type { Graph, GraphNode } from './api/types';
import './styles.css';

const STEP = 3;
const MAX = 150;
const PER_ROW = 8;
// Шире любой звезды: радиус на 150 связях — 49 единиц.
const SPACING = 170;

function range(from: number, to: number, step: number): number[] {
	const out: number[] = [];
	for (let value = from; value <= to; value += step) out.push(value);
	return out;
}

const DEGREES = [...new Set([...range(0, MAX, STEP), 24, 25])].sort((a, b) => a - b);
const ROWS = Math.ceil(DEGREES.length / PER_ROW);

function buildGraph(): Graph {
	const nodes: GraphNode[] = DEGREES.map((degree, i) => {
		const row = Math.floor(i / PER_ROW);
		const column = i % PER_ROW;
		return {
			id: `s${degree}`,
			name: `${degree}`,
			gender: i % 2 === 0 ? ('MALE' as const) : ('FEMALE' as const),
			age: null,
			degree,
			// Личный множитель числа языков: без него все звёзды горят одинаково.
			flame: 0.55 + ((i * 7) % 10) * 0.05,
			centrality: degree / MAX,
			x: (column - (PER_ROW - 1) / 2) * SPACING,
			y: (row - (ROWS - 1) / 2) * SPACING,
			avatar: null,
			isTest: true,
			isBlocked: false,
			coreColor: sandboxColors.core,
			flameColor: sandboxColors.flame,
		};
	});

	return {
		layoutVersion: 1,
		layoutScale: 1,
		me: nodes[0].id,
		nodes,
		edges: [],
		pending: [],
		dismissed: [],
	};
}

const canvas = document.getElementById('sky') as HTMLCanvasElement;
const renderer = createRenderer(canvas, { onPick: () => {}, onHover: () => {} }, { labelAll: true });

let graph = buildGraph();

createPanel(() => {
	graph = buildGraph();
	renderer.setGraph(graph);
});

renderer.camera.maxZoom = 40;

// Размер канвы рендерер узнаёт в первом кадре: до этого подгонка сводит небо в точку.
requestAnimationFrame(() => {
	renderer.setGraph(graph);
	requestAnimationFrame(() => {
		renderer.fit();
		// Адресом задаётся вид: ?star=<число связей>&zoom=<кратность>.
		const query = new URLSearchParams(location.search);
		const star = query.get('star');
		const node = star === null ? undefined : graph.nodes.find((item) => item.name === star);
		const zoom = Number(query.get('zoom'));
		const wanted = Number.isFinite(zoom) && zoom > 0 ? zoom : undefined;
		if (node) renderer.camera.flyTo(node.x, node.y, wanted, 0);
		else if (wanted !== undefined) renderer.camera.zoom = wanted;
	});
});

(window as unknown as { renderer: typeof renderer }).renderer = renderer;
