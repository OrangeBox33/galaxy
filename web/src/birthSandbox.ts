// Отладочная страница /galaxy/birth.html: в сборку не попадает.
// Первый вход на настоящем небе: граф и раскладка считаются так же, как
// на бою (новичок приходит инкрементально), рисует тот же createRenderer,
// камерой водит тот же entrance.ts, что и приложение.
import { computeLayout } from '../../shared/layout/index';
import { createRenderer } from './canvas/renderer';
import { birthTuning } from './canvas/birth';
import { awaitSpot, entranceTuning, flyAndIgnite, overview } from './canvas/entrance';
import {
	introTuning,
	type IntroMode,
	type IntroPace,
	type IntroRoot,
} from './canvas/constellationIntro';
import { createLayoutPanel, type Bag, type Control, type Section } from './layoutPanel';
import { buildTestGraph, DEFAULT_SHAPE } from './layout/testGraph';
import type { Graph, GraphNode } from './api/types';
import './styles.css';

const STORAGE_KEY = 'galaxy:birth-sandbox-5';
const COLORS_KEY = `${STORAGE_KEY}:colors`;

// Новичок цепляется к тесной компании: у неё соседи рядом, видно, куда он сел.
const ANCHORS = [50, 51, 52, 53, 54];

// serverMs — сколько «сервер» ищет место: на бою 0.6–2 с.
const view: Bag = { links: 2, serverMs: 1500, motley: false };

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
		dismissed: [],
		hubs: [],
		hubLimit: 0,
	};
}

function reset(): void {
	renderer.setGraph(build());
	renderer.setHidden([newborn]);
	status('готов');
}

async function run(steps: () => Promise<void>): Promise<void> {
	if (running) return;
	running = true;
	const started = performance.now();
	try {
		await steps();
	} finally {
		status(`${Math.round(performance.now() - started)} мс`);
		running = false;
	}
}

// Всё как на бою: рендерер на входе проявляет созвездия заново.
function enter(): Promise<void> {
	return run(async () => {
		reset();
		renderer.replayIntro();
		status('небо целиком…');
		await overview(renderer);
		await awaitSpot(wait(view.serverMs as number));
		status('рождается…');
		await flyAndIgnite(renderer, newborn, born, links());
	});
}

function birthOnly(): Promise<void> {
	return run(async () => {
		reset();
		renderer.fit();
		status('рождается…');
		await flyAndIgnite(renderer, newborn, born, links());
	});
}

function linesOnly(): void {
	renderer.fit();
	renderer.replayIntro();
}

function status(state: string): void {
	panel.setStatus(`${state} · связей ${links()}`);
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
		title: 'Вход',
		bag: view,
		controls: [
			{ kind: 'button', label: 'Вход целиком (пробел)', run: () => void enter() },
			{ kind: 'button', label: 'Только рождение', run: () => void birthOnly() },
			{ kind: 'button', label: 'Только линии', run: linesOnly },
			range('links', 'связей у новичка', 0, ANCHORS.length, 1),
			range('serverMs', 'сервер ищет место, мс', 0, 3000, 50),
			{ kind: 'toggle', key: 'motley', label: 'раскрасить всё небо' },
		],
	},
	{
		title: 'Камера',
		bag: entranceTuning as unknown as Bag,
		controls: [
			range('skyMs', 'небо целиком не меньше, мс', 0, 3000, 50),
			range('driftZoom', 'наплыв, раз', 1, 2.5, 0.05),
			range('driftMs', 'наплыв, мс', 500, 10000, 100),
			range('flyMs', 'подлёт, мс', 0, 3000, 50),
			range('pauseMs', 'пауза перед рождением, мс', 0, 1500, 50),
			range('radiusPx', 'звезда при рождении, px', 16, 160, 2),
			range('lift', 'подъём над окном, доля экрана', 0, 0.45, 0.01),
		],
	},
	{
		title: 'Линии на входе',
		bag: introTuning as unknown as Bag,
		controls: [
			{
				kind: 'choice',
				label: 'появление',
				options: [
					{ key: 'fade', label: 'разом' },
					{ key: 'wave', label: 'волна снизу' },
					{ key: 'lightning', label: 'молния' },
				],
				get: () => introTuning.mode,
				set: (value) => {
					introTuning.mode = value as IntroMode;
					linesOnly();
				},
			},
			{
				kind: 'choice',
				label: 'молния начинается',
				options: [
					{ key: 'bottom', label: 'от меня / снизу' },
					{ key: 'random', label: 'со случайной' },
				],
				get: () => introTuning.root,
				set: (value) => {
					introTuning.root = value as IntroRoot;
					linesOnly();
				},
			},
			{
				kind: 'choice',
				label: 'скорость молнии',
				options: [
					{ key: 'distance', label: 'ровная по небу' },
					{ key: 'hops', label: 'линия за равное время' },
				],
				get: () => introTuning.pace,
				set: (value) => {
					introTuning.pace = value as IntroPace;
					linesOnly();
				},
			},
			range('delay', 'чистое небо, мс', 0, 3000, 50),
			range('firstDuration', 'первая: проявление, мс (0 — без неё)', 0, 2000, 10),
			range('firstFlash', 'первая: вспышка, раз ярче', 0, 6, 0.1),
			range('firstFade', 'первая: гаснет до нуля за, мс', 10, 1000, 10),
			range('dark', 'темнота, мс', 0, 3000, 50),
			range('duration', 'вторая: проявление, мс', 300, 10000, 50),
			range('flash', 'вторая: вспышка, раз ярче', 0, 6, 0.1),
			range('afterglow', 'вторая: гаснет за, мс', 50, 3000, 50),
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
	snapshot: () => ({
		...colors,
		tuning: birthTuning,
		entrance: entranceTuning,
		intro: introTuning,
	}),
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
	void enter();
});

// Размер канвы рендерер узнаёт в первом кадре: до этого подгонка сводит небо в точку.
requestAnimationFrame(() => {
	reset();
	requestAnimationFrame(() => void enter());
});

(window as unknown as { renderer: typeof renderer }).renderer = renderer;
