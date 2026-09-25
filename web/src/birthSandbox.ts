// Отладочная страница /galaxy/birth.html: в сборку не попадает.
// Рождение звезды на настоящем небе: граф и раскладка считаются так же, как
// на бою (новичок приходит инкрементально), рисует тот же createRenderer.
import { computeLayout } from '../../shared/layout/index';
import { createRenderer } from './canvas/renderer';
import { birthTuning } from './canvas/birth';
import { createLayoutPanel, type Bag, type Control, type Section } from './layoutPanel';
import { buildTestGraph, DEFAULT_SHAPE } from './layout/testGraph';
import type { Graph, GraphNode } from './api/types';
import './styles.css';

const STORAGE_KEY = 'galaxy:birth-sandbox-2';
const COLORS_KEY = `${STORAGE_KEY}:colors`;

// Новичок цепляется к тесной компании: у неё соседи рядом, видно, куда он сел.
const ANCHORS = [50, 51, 52, 53, 54];

const view: Bag = { links: 2, zoom: 9, flyMs: 900, pauseMs: 250, motley: false };

const colors = { core: '#FFFFFF', flame: '#FFFFFF' };

// Пёстрое небо — проверка читаемости: не рассыпаются ли компании, когда цвет у каждого свой.
const MOTLEY: [string, string][] = [
	['#FFD9A8', '#8FD2FF'],
	['#FFE0E0', '#FF9EC4'],
	['#E6FFD9', '#9BE86B'],
	['#FFF3C4', '#FFB648'],
	['#DCE4FF', '#7C8BFF'],
	['#D9FFF6', '#4FD6C8'],
	['#F6D9FF', '#C57BFF'],
	['#FFE9D9', '#FF7A5A'],
];

const base = buildTestGraph(DEFAULT_SHAPE);
const newborn = String(base.count);

restoreColors();

const canvas = document.getElementById('sky') as HTMLCanvasElement;
const renderer = createRenderer(canvas, { onPick: () => {}, onHover: () => {} });
renderer.camera.maxZoom = 40;

let born = { x: 0, y: 0 };
let running = false;

function links(): number {
	return Math.max(0, Math.min(ANCHORS.length, Math.round(view.links as number)));
}

function build(): Graph {
	const ids = Array.from({ length: base.count }, (_, i) => BigInt(i + 1));
	const full = computeLayout({ ids, edges: base.edges, full: true });
	const previous = new Map(full.nodes.map((node) => [node.id, { x: node.x, y: node.y }]));

	const edges: [number, number][] = [
		...base.edges,
		...ANCHORS.slice(0, links()).map((anchor) => [anchor, base.count] as [number, number]),
	];
	const layout = computeLayout({
		ids: [...ids, BigInt(base.count + 1)],
		edges,
		previous,
		previousScale: full.scale,
	});

	const nodes: GraphNode[] = layout.nodes.map((node, i) => {
		const mine = String(i) === newborn;
		const motley = view.motley === true ? MOTLEY[i % MOTLEY.length] : null;
		return {
			id: String(i),
			name: mine ? 'новичок' : `${node.degree}`,
			gender: 'MALE' as const,
			age: null,
			degree: node.degree,
			flame: 0.55 + ((i * 7) % 10) * 0.05,
			centrality: node.centrality,
			x: node.x,
			y: node.y,
			avatar: null,
			isTest: true,
			isBlocked: false,
			coreColor: mine ? colors.core : (motley?.[0] ?? null),
			flameColor: mine ? colors.flame : (motley?.[1] ?? null),
		};
	});

	const spot = nodes.find((node) => node.id === newborn);
	if (spot) born = { x: spot.x, y: spot.y };

	return {
		layoutVersion: 1,
		layoutScale: layout.scale,
		me: newborn,
		nodes,
		edges: edges.map(([a, b]) => [String(a), String(b)] as [string, string]),
		pending: [],
		dismissed: [],
	};
}

function reset(): void {
	renderer.setGraph(build());
	renderer.setHidden([newborn]);
	status('готов');
}

async function play(): Promise<void> {
	if (running) return;
	running = true;
	reset();

	renderer.camera.flyTo(born.x, born.y, view.zoom as number, view.flyMs as number);
	await wait((view.flyMs as number) + (view.pauseMs as number));

	const started = performance.now();
	status('рождается…');
	await renderer.ignite(newborn);
	status(`${Math.round(performance.now() - started)} мс`);
	running = false;
}

function status(state: string): void {
	panel.setStatus(`${state} · связей ${links()} · зум ${view.zoom}`);
}

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const range = (key: string, label: string, min: number, max: number, step: number): Control => ({
	kind: 'range',
	key,
	label,
	min,
	max,
	step,
});

const sections: Section[] = [
	{
		title: 'Рождение',
		bag: view,
		controls: [
			{ kind: 'button', label: 'Родить заново (пробел)', run: () => void play() },
			range('links', 'связей у новичка', 0, ANCHORS.length, 1),
			range('zoom', 'зум при рождении', 1, 30, 0.5),
			range('flyMs', 'подлёт камеры, мс', 0, 2000, 50),
			range('pauseMs', 'пауза перед рождением, мс', 0, 1500, 50),
			{ kind: 'toggle', key: 'motley', label: 'раскрасить всё небо' },
		],
	},
	{
		title: 'Цвета звезды',
		bag: {},
		controls: [
			{
				kind: 'color',
				label: 'диск',
				get: () => colors.core,
				set: (value) => {
					colors.core = value;
					saveColors();
					reset();
				},
			},
			{
				kind: 'color',
				label: 'языки пламени',
				get: () => colors.flame,
				set: (value) => {
					colors.flame = value;
					saveColors();
					reset();
				},
			},
		],
	},
	{
		title: 'Сгущение',
		bag: birthTuning as unknown as Bag,
		controls: [
			range('duration', 'длительность, мс', 800, 8000, 50),
			range('particles', 'сколько пылинок', 8, 400, 1),
			range('from', 'откуда летят', 4, 40, 0.5),
			range('gather', 'когда схлопнется', 0.2, 0.9, 0.01),
			range('swirl', 'закрутка', 0, 8, 0.1),
			range('tail', 'длина хвоста', 0.1, 5, 0.1),
			range('power', 'сила вспышки', 2, 16, 0.5),
			range('warm', 'багровость зародыша', 0, 1, 0.01),
			range('overshoot', 'перелёт размера', 1, 4, 0.05),
			range('settle', 'усадка после перелёта', 0.1, 0.9, 0.01),
		],
	},
];

const panel = createLayoutPanel({
	sections,
	snapshot: () => ({ ...colors, tuning: birthTuning }),
	onChange: () => reset(),
	storageKey: STORAGE_KEY,
});

function saveColors(): void {
	localStorage.setItem(COLORS_KEY, JSON.stringify(colors));
}

function restoreColors(): void {
	const raw = localStorage.getItem(COLORS_KEY);
	if (!raw) return;
	try {
		Object.assign(colors, JSON.parse(raw) as typeof colors);
	} catch {
		localStorage.removeItem(COLORS_KEY);
	}
}

window.addEventListener('keydown', (event) => {
	if (event.code !== 'Space') return;
	event.preventDefault();
	void play();
});

// Размер канвы рендерер узнаёт в первом кадре: до этого подгонка сводит небо в точку.
requestAnimationFrame(() => {
	reset();
	requestAnimationFrame(() => {
		renderer.fit();
		void play();
	});
});

(window as unknown as { renderer: typeof renderer }).renderer = renderer;
