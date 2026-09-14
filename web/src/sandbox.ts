// Песочница: полсотни звёзд на настоящем небе, без сервера, базы и Telegram.
// Нужна, чтобы крутить вид звезды ползунками и видеть результат сразу:
// `npm run dev` в web/ и открыть /galaxy/sandbox.html. В сборку не попадает —
// vite собирает только index.html. Связей нет намеренно: они и так скрыты
// (EDGES_HIDDEN) и мешали бы смотреть на пламя.
import { createRenderer } from './canvas/renderer';
import { createPanel } from './panel';
import type { Graph, GraphNode } from './api/types';
import './styles.css';

// Все звёзды от 1 до 50 связей, по десять в ряду: видно и мелкий шаг внизу,
// и куда приходит рост к полусотне.
const DEGREES = Array.from({ length: 50 }, (_, i) => i + 1);
const PER_ROW = 10;
// Те же десять ступеней личного множителя, что раздаёт сервер.
const FLAMES = [0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95, 1];
// Полсотни связей — это радиус 18, поэтому шаг такой широкий.
const SPACING = 110; // мировых единиц между звёздами в ряду
const ROW_SPACING = 110; // и между рядами
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
		// В приложении этот множитель достаётся человеку при первом входе
		// и хранится в БД; здесь раздаём его по кругу, чтобы видеть разброс.
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
	me: nodes[0].id,
	nodes,
	// Связей нет: рисуем только сами звёзды.
	edges: [],
	pending: [],
};

// Панель ползунков: она же возвращает подобранное после перезагрузки.
createPanel();

const canvas = document.getElementById('sky') as HTMLCanvasElement;
const renderer = createRenderer(
	canvas,
	{ onPick: () => {}, onHover: () => {} },
	// Подписываем все звёзды и на любом масштабе: иначе не понять,
	// у какой сколько связей.
	{ labelAll: true },
);

// Приближать даём гораздо ближе боевого потолка (там 4): звезду нужно уметь
// разглядеть в упор. Колесо мыши, щипок или renderer.zoomBy(1.5) в консоли.
renderer.camera.maxZoom = 40;

// Граф отдаём не сразу: размер канваса рендерер узнаёт в первом же кадре,
// а до этого подгонка под экран считает масштаб от нулевой ширины и сводит
// небо в точку. В боевом приложении данные и так приходят позже.
requestAnimationFrame(() => {
	renderer.setGraph(graph);
	requestAnimationFrame(() => {
		renderer.fit();
		// ?zoom=12&star=15 — сразу упереться в нужную звезду. Удобно и руками,
		// и когда снимок делает скрипт: состояние задаётся адресом.
		const query = new URLSearchParams(location.search);
		const star = query.get('star');
		const node = star === null ? undefined : nodes.find((n) => n.name === star);
		const zoom = Number(query.get('zoom'));
		const wanted = Number.isFinite(zoom) && zoom > 0 ? zoom : undefined;
		// Перелёт и масштаб задаём одним движением: focusOn летит со своим
		// зумом и затирает выставленный руками.
		if (node) renderer.camera.flyTo(node.x, node.y, wanted, 0);
		else if (wanted !== undefined) renderer.camera.zoom = wanted;
	});
});

// Ссылка на рендерер в консоли: удобно дёргать zoomBy/fit руками.
(window as unknown as { renderer: typeof renderer }).renderer = renderer;
