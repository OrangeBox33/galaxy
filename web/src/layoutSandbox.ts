// Отладочная страница /galaxy/layout-sandbox.html: в сборку не попадает.
// Настоящая раскладка на выдуманном графе; ползунки правят те же числа, что
// в shared/layout/params.ts, и подобранное копируется кнопкой обратно туда.
import { STAR_COLORS } from '../../shared/config';
import { computeLayout, type LayoutResult } from '../../shared/layout/index';
import { LAYOUT_PARAMS, starRadius, type LayoutOverrides } from '../../shared/layout/params';
import { createRenderer, tuning } from './canvas/renderer';
import { createLayoutPanel, type Bag, type Control } from './layoutPanel';
import { buildTestGraph, DEFAULT_SHAPE, type Shape, type TestGraph } from './layout/testGraph';
import type { Graph, GraphNode } from './api/types';
import './styles.css';

const TUNED: (keyof typeof LAYOUT_PARAMS)[] = [
	'R_MAX',
	'K_CENTROID',
	'CENTROID_DEGREE_FADE',
	'K_LOCAL',
	'LOCAL_SPAN',
	'K_GROUP_RAD',
	'K_GROUP_REP',
	'K_RAD',
	'RAD_DEGREE_FADE',
	'K_REP',
	'K_SPR',
	'L0',
	'REP_COMPONENT',
	'DAMPING',
	'COOLING',
	'FULL_ITERATIONS',
	'SCALE_PERCENTILE',
];

const params: Bag = Object.fromEntries(TUNED.map((key) => [key, LAYOUT_PARAMS[key]]));
const shape: Shape = { ...DEFAULT_SHAPE };
const view: Bag = {
	schema: true,
	colorByCluster: false,
	showEdges: true,
	labels: false,
	minZoomFactor: 0.25,
};

const range = (key: string, label: string, min: number, max: number, step: number): Control => ({
	kind: 'range',
	key,
	label,
	min,
	max,
	step,
});

// Треть звёзд оставлена белыми, остальным раздан настоящий цвет из палитры:
// по белому небу не видно, докуда по связи доходит цвет.
function sandboxColor(index: number): string | null {
	if (index % 3 === 2) return null;
	return STAR_COLORS[(index * 5) % STAR_COLORS.length];
}

let layoutSnapshot = '';
let graph: TestGraph = buildTestGraph(shape);
let result: LayoutResult | null = null;
// Позиции прошлого прогона: с ними раскладка идёт инкрементально, как на бою.
let previous = new Map<bigint, { x: number; y: number }>();
let extra: [number, number][] = [];
let extraCount = 0;

function allEdges(): [number, number][] {
	return [...graph.edges, ...extra];
}

function totalCount(): number {
	return graph.count + extraCount;
}

function overrides(): LayoutOverrides {
	return params as unknown as LayoutOverrides;
}

function recompute(full: boolean): void {
	const count = totalCount();
	const ids = Array.from({ length: count }, (_, i) => BigInt(i + 1));
	const started = performance.now();
	result = computeLayout({
		ids,
		edges: allEdges(),
		previous: full ? undefined : previous,
		full,
		params: overrides(),
	});
	const ms = performance.now() - started;

	previous = new Map(result.nodes.map((node) => [node.id, { x: node.x, y: node.y }]));
	renderer.setGraph(toGraph(result));
	panel.setStatus(status(result, ms));
}

function toGraph(layout: LayoutResult): Graph {
	const nodes: GraphNode[] = layout.nodes.map((node, i) => ({
		id: String(i),
		name: `${node.degree}`,
		gender: 'MALE' as const,
		age: null,
		degree: node.degree,
		// Только чтобы звёзды не были одинаковыми; на раскладку не влияет.
		flame: 0.55 + ((i * 7) % 10) * 0.05,
		centrality: node.centrality,
		x: node.x,
		y: node.y,
		avatar: null,
		coreColor: sandboxColor(i),
		flameColor: sandboxColor(i),
		isTest: true,
		isBlocked: false,
	}));
	return {
		layoutVersion: 1,
		layoutScale: layout.scale,
		me: '0',
		nodes,
		edges: allEdges().map(([a, b]) => [String(a), String(b)] as [string, string]),
		dismissed: [],
	};
}

function spearman(a: number[], b: number[]): number {
	const n = a.length;
	if (n < 4) return 0;
	const rank = (values: number[]): number[] => {
		const order = values.map((v, i) => [v, i] as const).sort((p, q) => p[0] - q[0]);
		const out = new Array<number>(values.length);
		order.forEach(([, i], k) => (out[i] = k));
		return out;
	};
	const ra = rank(a);
	const rb = rank(b);
	const mean = (n - 1) / 2;
	let num = 0;
	let da = 0;
	let db = 0;
	for (let i = 0; i < n; i += 1) {
		num += (ra[i] - mean) * (rb[i] - mean);
		da += (ra[i] - mean) ** 2;
		db += (rb[i] - mean) ** 2;
	}
	return da === 0 || db === 0 ? 0 : num / Math.sqrt(da * db);
}

// Два главных замера: во сколько раз знакомые ближе незнакомых (мера «каши») и держится
// ли внутри компании «знаешь своих лучше — стоишь ближе к её середине» (−1 идеально).
function status(layout: LayoutResult, ms: number): string {
	const n = layout.nodes.length;
	const linked = new Set(allEdges().map(([a, b]) => `${a}:${b}`));
	let near = 0;
	let nearCount = 0;
	let far = 0;
	let farCount = 0;
	for (let i = 0; i < n; i += 1) {
		for (let j = i + 1; j < n; j += 1) {
			const d = Math.hypot(layout.nodes[i].x - layout.nodes[j].x, layout.nodes[i].y - layout.nodes[j].y);
			if (linked.has(`${i}:${j}`)) {
				near += d;
				nearCount += 1;
			} else {
				far += d;
				farCount += 1;
			}
		}
	}
	const ratio = nearCount > 0 && farCount > 0 ? near / nearCount / (far / farCount) : NaN;

	const inside = new Map<number, number[]>();
	for (let i = 0; i < n; i += 1) {
		const list = inside.get(layout.nodes[i].cluster) ?? [];
		list.push(i);
		inside.set(layout.nodes[i].cluster, list);
	}
	const degreeInside = new Array<number>(n).fill(0);
	for (const [a, b] of allEdges()) {
		if (layout.nodes[a].cluster === layout.nodes[b].cluster) {
			degreeInside[a] += 1;
			degreeInside[b] += 1;
		}
	}
	let weighted = 0;
	let weight = 0;
	for (const list of inside.values()) {
		if (list.length < 4) continue;
		const cx = list.reduce((sum, i) => sum + layout.nodes[i].x, 0) / list.length;
		const cy = list.reduce((sum, i) => sum + layout.nodes[i].y, 0) / list.length;
		const rho = spearman(
			list.map((i) => degreeInside[i]),
			list.map((i) => Math.hypot(layout.nodes[i].x - cx, layout.nodes[i].y - cy)),
		);
		weighted += rho * list.length;
		weight += list.length;
	}
	const local = weight > 0 ? weighted / weight : 0;

	const clusters = inside.size;
	const components = new Set(layout.nodes.map((node) => node.component)).size;
	return (
		`${n} звёзд, ${allEdges().length} связей · ${ms.toFixed(0)} мс\n` +
		`знакомые ближе в ${(1 / ratio).toFixed(2)} раза · место в компании ${local.toFixed(2)}\n` +
		`компаний ${clusters}, не связанных групп ${components}`
	);
}

// Своей канвой поверх неба: на схеме видны все связи разом и кто к какой компании отнесён.
const overlay = document.createElement('canvas');
overlay.className = 'sky__canvas';
// .sky__canvas — обычный блок: без position вторая канва уедет за нижний край.
overlay.style.position = 'absolute';
overlay.style.inset = '0';
overlay.style.pointerEvents = 'none';
document.getElementById('root')!.append(overlay);
const octx = overlay.getContext('2d')!;

function clusterColor(index: number): string {
	// Золотой угол по кругу оттенков: соседние номера сообществ не сливаются.
	return `hsl(${(index * 137.508) % 360} 70% 62%)`;
}

function drawSchema(): void {
	const dpr = window.devicePixelRatio || 1;
	const width = overlay.clientWidth;
	const height = overlay.clientHeight;
	if (overlay.width !== Math.round(width * dpr) || overlay.height !== Math.round(height * dpr)) {
		overlay.width = Math.round(width * dpr);
		overlay.height = Math.round(height * dpr);
	}
	octx.setTransform(dpr, 0, 0, dpr, 0, 0);
	octx.clearRect(0, 0, width, height);
	if (!view.schema || !result) return;

	octx.fillStyle = '#05070f';
	octx.fillRect(0, 0, width, height);

	const camera = renderer.camera;
	const sx = (i: number): number => camera.worldToScreenX(result!.nodes[i].x);
	const sy = (i: number): number => camera.worldToScreenY(result!.nodes[i].y);

	if (view.showEdges) {
		octx.lineWidth = 1;
		for (const [a, b] of allEdges()) {
			const sameCluster = result.nodes[a].cluster === result.nodes[b].cluster;
			// Мостик наружу виден отдельно: по нему и судят, держится ли рисунок.
			octx.strokeStyle = sameCluster ? 'rgba(150,175,220,0.30)' : 'rgba(255,190,120,0.75)';
			octx.beginPath();
			octx.moveTo(sx(a), sy(a));
			octx.lineTo(sx(b), sy(b));
			octx.stroke();
		}
	}

	for (let i = 0; i < result.nodes.length; i += 1) {
		const node = result.nodes[i];
		const radius = Math.max(2.5, starRadius(node.degree) * camera.zoom);
		octx.fillStyle = view.colorByCluster
			? clusterColor(node.cluster)
			: (graph.groups[graph.groupOf[i] ?? 0]?.color ?? '#ffffff');
		octx.beginPath();
		octx.arc(sx(i), sy(i), radius, 0, Math.PI * 2);
		octx.fill();

		if (view.labels && camera.zoom > 0.25) {
			octx.fillStyle = 'rgba(220,232,255,0.8)';
			octx.font = '10px -apple-system, sans-serif';
			octx.fillText(String(node.degree), sx(i) + radius + 2, sy(i) + 3);
		}
	}
}

const legend = document.createElement('div');
legend.className = 'lay__legend';
function drawLegend(): void {
	legend.innerHTML = '';
	if (view.colorByCluster) {
		legend.textContent = 'цвет — сообщество, найденное раскладкой';
		return;
	}
	for (const group of graph.groups) {
		if (group.to === group.from) continue;
		const line = document.createElement('span');
		const dot = document.createElement('i');
		dot.style.background = group.color;
		line.append(dot, document.createTextNode(`${group.label} — ${group.to - group.from}`));
		legend.append(line);
	}
}
document.body.append(legend);

function regenerate(): void {
	graph = buildTestGraph(shape);
	extra = [];
	extraCount = 0;
	previous = new Map();
	drawLegend();
	recompute(true);
	requestAnimationFrame(() => renderer.fit());
}

// Расчёт инкрементальный, как на бою: видно, куда встанет новичок.
function addStar(friends: number): void {
	const index = totalCount();
	const picked = new Set<number>();
	for (let k = 0; k < friends && picked.size < index; k += 1) {
		for (let tries = 0; tries < 40; tries += 1) {
			const candidate = Math.floor(Math.random() * index);
			// Из суперкластера: там видно, вытащит ли новичка к друзьям или размажет по орбите.
			if (!picked.has(candidate) && (graph.groupOf[candidate] ?? 0) === 0) {
				picked.add(candidate);
				break;
			}
		}
	}
	for (const friend of picked) extra.push([friend, index]);
	extraCount += 1;
	graph.groupOf[index] = 0;
	recompute(false);
}

const canvas = document.getElementById('sky') as HTMLCanvasElement;
let selected: string | null = null;
const renderer = createRenderer(
	canvas,
	{
		// Выбор здесь только ради связей: цепочку и её соседей иначе не увидеть.
		onPick: (pick) => {
			selected = pick.kind === 'node' && pick.id !== selected ? pick.id : null;
			renderer.setSelection(selected);
		},
		onHover: () => {},
	},
	{ showEdges: Boolean(view.showEdges) },
);

const panel = createLayoutPanel({
	storageKey: 'galaxy:layout-sandbox-1',
	snapshot: () => ({ params, shape }),
	onChange: () => {
		renderer.camera.minZoomFactor = Number(view.minZoomFactor);
		renderer.setShowEdges(Boolean(view.showEdges));
		// Ползунки связей до раскладки не касаются: пересчитывать её незачем.
		const next = JSON.stringify([params, shape]);
		if (next === layoutSnapshot) return;
		layoutSnapshot = next;
		schedule();
	},
	sections: [
		{
			title: 'Связи выбранной звезды',
			bag: tuning.edge as unknown as Bag,
			controls: [
				range('chain', 'яркость цепочки до меня', 0, 1, 0.01),
				range('selected', 'яркость остальных её связей', 0, 1, 0.01),
				range('reach', 'докуда доходит цвет звезды', 0, 0.5, 0.01),
			],
		},
		{
			title: 'Вид',
			bag: view,
			controls: [
				{ kind: 'toggle', key: 'schema', label: 'схема вместо неба' },
				{ kind: 'toggle', key: 'showEdges', label: 'показывать связи' },
				{ kind: 'toggle', key: 'colorByCluster', label: 'красить по сообществам' },
				{ kind: 'toggle', key: 'labels', label: 'подписывать число связей' },
				range('minZoomFactor', 'докуда отдалять (меньше — дальше)', 0.05, 1, 0.05),
				{ kind: 'button', label: 'Вписать небо в экран', run: () => renderer.fit() },
			],
		},
		{
			title: 'Структура',
			bag: params,
			controls: [
				range('K_LOCAL', 'место внутри своей компании', 0, 0.3, 0.005),
				range('LOCAL_SPAN', '…размер компании, в долях неба', 0.2, 1.4, 0.05),
				range('K_CENTROID', 'тяга к середине между друзьями', 0, 1.2, 0.01),
				range('CENTROID_DEGREE_FADE', '…слабее у звезды с многими друзьями', 0, 1.5, 0.05),
			],
		},
		{
			title: 'Разнести компании',
			bag: params,
			controls: [
				range('K_GROUP_REP', 'расталкивать компании друг от друга', 0, 4000, 50),
				range('K_GROUP_RAD', 'орбита компании по её размеру', 0, 0.3, 0.005),
				range('REP_COMPONENT', 'отталкивание незнакомых компонент', 1, 12, 0.25),
			],
		},
		{
			title: 'Просторность',
			bag: params,
			controls: [
				range('R_MAX', 'радиус неба', 400, 4000, 50),
				range('K_RAD', 'удержание всего неба в кадре', 0, 0.4, 0.005),
				range('RAD_DEGREE_FADE', '…слабее у звезды с многими связями', 0, 2, 0.05),
				range('SCALE_PERCENTILE', 'по какому радиусу мерить небо', 0.3, 1, 0.05),
				range('K_REP', 'отталкивание', 0, 6000, 50),
				range('L0', 'длина покоя связи', 10, 400, 5),
				range('K_SPR', 'жёсткость связи', 0, 0.3, 0.005),
			],
		},
		{
			title: 'Сходимость',
			bag: params,
			controls: [
				range('DAMPING', 'вязкость', 0.5, 0.99, 0.01),
				range('COOLING', 'охлаждение', 0.9, 0.999, 0.001),
				range('FULL_ITERATIONS', 'потолок итераций', 50, 2000, 50),
			],
		},
		{
			title: 'Новая звезда',
			bag: view,
			controls: [
				{ kind: 'button', label: '+ звезда с 1 другом', run: () => addStar(1) },
				{ kind: 'button', label: '+ звезда с 2 друзьями', run: () => addStar(2) },
				{ kind: 'button', label: '+ звезда с 3 друзьями', run: () => addStar(3) },
				{ kind: 'button', label: '+ одинокая звезда', run: () => addStar(0) },
			],
		},
		{
			title: 'Тестовый граф',
			bag: shape as unknown as Bag,
			controls: [
				range('seed', 'зерно', 1, 40, 1),
				range('hubCount', 'суперкластер: звёзд', 3, 200, 1),
				range('hubLinks', '…связей у новичка', 1, 6, 1),
				range('hubExtra', '…добавочных связей', 0, 2, 0.05),
				range('tightCount', 'тесная компания: звёзд', 0, 40, 1),
				range('tightDensity', '…плотность', 0, 1, 0.05),
				range('tightBridges', '…мостиков наружу', 0, 6, 1),
				range('midCount', 'компания посвободнее: звёзд', 0, 40, 1),
				range('midDensity', '…плотность', 0, 1, 0.05),
				range('midBridges', '…мостиков наружу', 0, 6, 1),
				range('chainCount', 'цепочка: звёзд', 0, 20, 1),
				range('pairCount', 'пар ни с кем', 0, 20, 1),
				range('lonerCount', 'одиночек', 0, 30, 1),
				{ kind: 'button', label: 'Пересобрать граф', run: regenerate },
			],
		},
	],
});

// Полный пересчёт сотни звёзд — десятки миллисекунд: без задержки панель залипает.
let timer = 0;
function schedule(): void {
	window.clearTimeout(timer);
	timer = window.setTimeout(() => {
		const rebuilt = buildTestGraph(shape);
		const changed = rebuilt.count !== graph.count || rebuilt.edges.length !== graph.edges.length;
		if (changed) {
			regenerate();
			return;
		}
		recompute(true);
	}, 120);
}

function loop(): void {
	canvas.style.visibility = view.schema ? 'hidden' : 'visible';
	drawSchema();
	requestAnimationFrame(loop);
}

// Размер канвы рендерер узнаёт в первом кадре: до этого подгонка сводит небо в точку.
requestAnimationFrame(() => {
	drawLegend();
	renderer.camera.minZoomFactor = Number(view.minZoomFactor);
	renderer.setShowEdges(Boolean(view.showEdges));
	layoutSnapshot = JSON.stringify([params, shape]);
	recompute(true);
	requestAnimationFrame(() => renderer.fit());
	loop();
});

(window as unknown as { renderer: typeof renderer }).renderer = renderer;
