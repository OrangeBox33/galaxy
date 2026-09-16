// Отладочная страница /galaxy/sandbox.html: в сборку не попадает.
import { createRenderer } from './canvas/renderer';
import { createPanel } from './panel';
import type { Graph, GraphNode } from './api/types';
import './styles.css';

const DEGREES = Array.from({ length: 50 }, (_, i) => i + 1);
const PER_ROW = 10;
const FLAMES = [0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95, 1];
const SPACING = 110;
const ROW_SPACING = 110;
const rowCount = Math.ceil(DEGREES.length / PER_ROW);

const nodes: GraphNode[] = DEGREES.map((degree, i) => {
	const row = Math.floor(i / PER_ROW);
	const column = i % PER_ROW;
	return {
		id: `s${degree}`,
		name: `${degree}`,
		gender: i % 2 === 0 ? ('MALE' as const) : ('FEMALE' as const),
		age: null,
		degree,
		flame: FLAMES[i % FLAMES.length],
		centrality: degree / DEGREES.length,
		x: (column - (PER_ROW - 1) / 2) * SPACING,
		y: (row - (rowCount - 1) / 2) * ROW_SPACING,
		avatar: null,
		isTest: true,
		isBlocked: false,
	};
});

const graph: Graph = {
	layoutVersion: 1,
	layoutScale: 1,
	me: nodes[0].id,
	nodes,
	edges: [],
	pending: [],
	dismissed: [],
};

createPanel();

const canvas = document.getElementById('sky') as HTMLCanvasElement;
const renderer = createRenderer(
	canvas,
	{ onPick: () => {}, onHover: () => {} },
	{ labelAll: true },
);

renderer.camera.maxZoom = 40;

// Размер канвы рендерер узнаёт в первом кадре: до этого подгонка сводит небо в точку.
requestAnimationFrame(() => {
	renderer.setGraph(graph);
	requestAnimationFrame(() => {
		renderer.fit();
		const query = new URLSearchParams(location.search);
		const star = query.get('star');
		const node = star === null ? undefined : nodes.find((n) => n.name === star);
		const zoom = Number(query.get('zoom'));
		const wanted = Number.isFinite(zoom) && zoom > 0 ? zoom : undefined;
		if (node) renderer.camera.flyTo(node.x, node.y, wanted, 0);
		else if (wanted !== undefined) renderer.camera.zoom = wanted;
	});
});

(window as unknown as { renderer: typeof renderer }).renderer = renderer;
