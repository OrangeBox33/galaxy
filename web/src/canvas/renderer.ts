// Рендер неба: один requestAnimationFrame-цикл на всё (раздел 8).
// Порядок отрисовки: фон → пыль → рёбра → ореолы → ядра → подписи.
import type { Graph } from '../api/types';
import { clamp01, easeInOutCubic, easeOutBack, prefersReducedMotion } from './animate';
import { Camera } from './camera';
import { DUST_PARALLAX, DUST_TILE_SIZE, dustTile } from './dust';
import {
	CORE,
	CORE_RGB,
	SKY_BOTTOM,
	SKY_MID,
	SKY_TOP,
	mix,
	rgb,
	rgba,
	type RGB,
} from './palette';
import {
	APPEAR_DURATION,
	DRAW_EDGE_MS,
	emptyScene,
	starPosition,
	syncScene,
	type InviteDot,
	type Scene,
	type Star,
} from './scene';
import { stepWobble, type Grab } from './wobble';

export type Pick =
	| { kind: 'node'; id: string }
	| { kind: 'invite'; id: string }
	| { kind: 'empty' };

// Связи скрыты целиком. Огрызки связей у звезды (drawFlare) складывались
// в несимметричное свечение: если соседи собрались слева, звезда «светила»
// налево, и венец переставал быть ровным. Код связей цел — чтобы вернуть их,
// достаточно поставить здесь false.
export const EDGES_HIDDEN = true;

// Как рисовать связи:
//   'glow'  — линия светится только рядом со звёздами, вдали гаснет;
//   'full'  — сплошные линии по всей длине, как на обычном графе.
export type EdgeMode = 'glow' | 'full';

export type RendererHandlers = {
	onPick: (pick: Pick) => void;
	onHover: (id: string | null) => void;
};

// Допуск попадания: радиус звезды плюс запас. Запас задан в мировых единицах,
// но не может быть меньше 14 экранных пикселей — иначе на отдалённой карте
// в звезду невозможно попасть пальцем.
const HIT_PAD_WORLD = 8;
const HIT_PAD_MIN_SCREEN = 14;

// Глубина: ближние звёзды крупнее и при движении карты смещаются сильнее
// дальних. Это не настоящее 3D, а параллакс — но объём читается именно так.
const DEPTH_STRENGTH = 0.22;

// Линия светится только рядом со звездой — на столько её радиусов,
// а дальше гаснет. Так плотные места остаются паутиной света, а длинные
// перемычки между далёкими звёздами перестают затягивать небо сеткой.
const EDGE_GLOW_RADII = 2.5;
// Яркость линии вплотную к звезде и вдали от любой звезды.
const EDGE_ALPHA_NEAR = 0.34;
const EDGE_ALPHA_FAR = 0.015;
// Яркость в сплошном режиме: линий видно много, поэтому каждая тусклее.
const EDGE_ALPHA_PLAIN = 0.22;

// ── Излучение ──────────────────────────────────────────────────────────
// Связь выходит из звезды не прямой палкой, а изгибом — как след
// вырывающегося потока. Изгиб медленно колышется, амплитуда растёт
// с числом связей: у хаба энергии больше.
const BEND_BASE = 0.11; // доля длины связи при одной связи
const BEND_PER_LINK = 0.012; // прибавка за каждую следующую
const BEND_MAX = 0.32;
const BEND_PERIOD = [7, 14]; // секунды, от и до

// ── Венец ──────────────────────────────────────────────────────────────
// Вокруг звезды — языки пламени, срисованные с солнца из референса
// (placidplace-sun-6751_128.gif в корне репозитория). Свечение звезды —
// не шар вокруг неё, а мягкая копия тех же языков: свет идёт от пламени.
//
// Языков немного, и с размером звезды их число растёт еле-еле: у звезды
// с одной связью двенадцать, у звезды с 25 связями пятнадцать-шестнадцать.
// Между этими точками — прямая по радиусу, дальше она же продолжается.
// Плотность на единицу окружности при этом падает, то есть у большой звезды
// язык получается шире — так и задумано.
const CORONA_TONGUES_AT = [
	{ radius: 4.0, tongues: 12 }, // звезда с одной связью
	{ radius: 12.8, tongues: 15.5 }, // звезда с 25 связями
];
const CORONA_TONGUES_MIN = 8;
const CORONA_TONGUES_MAX = 24;
// Мельче этого в пикселях венец не рисуем: языки всё равно не разглядеть.
const CORONA_MIN_SCREEN = 7;
// Сколько венцов рисуем за кадр: при сильном приближении их место занимают
// самые крупные звёзды, а мелочь обходится точкой.
const CORONA_MAX_STARS = 40;

// Личный множитель числа языков приходит с сервера (User.flame): 0.55…1,
// выдаётся при первом входе и закреплён за человеком навсегда.
export type Flame = {
	tongues: number; // общий множитель числа языков поверх личного
	from: number; // начало языка, в радиусах звезды
	length: number; // длина сверх радиуса звезды
	width: number; // ширина у основания, в долях углового шага
	taper: number; // насколько язык пузатый: 0 — острый клин, 1 — лепесток
	sweep: number; // подворот острия вбок, радианы
	bow: number; // где приходится изгиб: 0 — у основания, 1 — у острия
	alpha: number; // яркость
	plateau: number; // доля длины, на которой язык держит яркость
	flicker: number; // насколько гуляет длина: 0 — стоит, 1 — от нуля до полной
	flickerSpeed: number; // секунд на цикл мерцания
	spin: number; // секунд на оборот венца, 0 — не вращается
	// Мягкая копия языков — она и есть свечение звезды.
	soft: number; // её яркость от яркости языков, 0 — нет
	softWidth: number; // во сколько раз она шире и длиннее
	softShift: number; // перенос копии к центру, в радиусах звезды
	softFrom: number; // своё начало копии; 0 — там же, где начинаются языки
};

// ── Ядро ───────────────────────────────────────────────────────────────
// Диск светлеет не к центру, а к краю: середина уходит в цвет звезды,
// у самого края почти белая. Сразу за краем — короткий ореол в тот же цвет,
// пятая часть радиуса: он отделяет диск от пламени.
// Мельче этого в пикселях градиента не разглядеть — заливаем ровным цветом
// и экономим два градиента на звезду.
const CORE_GRADIENT_MIN = 3;

// Ближний к звезде кусок связи рисуется отдельно и толще. Пока связи скрыты
// (EDGES_HIDDEN) — не рисуется, но код цел.
const FLARE_WIDTH = 0.5; // доля радиуса звезды
const FLARE_MIN_SCREEN = 3.5; // короче этого не рисуем: не видно
const FLARE_MAX = 700; // предел числа огрызков за кадр

// Вид звезды подбирается ползунками в песочнице (web/src/sandbox.ts):
// рендерер читает эти значения каждый кадр, поэтому правка видна сразу.
// В приложении их никто не трогает.
export const tuning = {
	flame: {
		tongues: 1,
		from: 0.59,
		length: 0.05,
		width: 0.85,
		taper: 0.21,
		sweep: 0,
		bow: 0,
		alpha: 0.6,
		plateau: 0.6,
		flicker: 0.39,
		flickerSpeed: 0.2,
		spin: 82,
		soft: 0.5,
		softWidth: 2.85,
		softShift: 0.02,
		softFrom: 0.49,
	} as Flame,

	coreSize: 0.53, // радиус диска в долях радиуса звезды
	coreTint: 0.35, // насколько центр уходит в цвет звезды
	coreSharp: 0.6, // докуда центр держит свой цвет, в долях кромки
	coreRim: 1, // с какой доли радиуса диск уже самый светлый
	coreGlow: 0.2, // ореол за краем диска, в долях его радиуса
	coreGlowAlpha: 0.5, // яркость этого ореола
	corePulse: 0.02, // насколько диск дышит, в долях радиуса
	corePulsePeriod: 5, // секунд на вдох-выдох

	// Пыль: выше единицы плотность набирается повторными проходами.
	dustAlpha: 1.4,
};

const TAP_SLOP = 6; // пикселей: дальше это уже перетаскивание, а не тап
const LABEL_ZOOM = 1.2;

// Настройки, нужные только песочнице (web/src/sandbox.ts): на боевой карте
// подписи показываются по своим правилам, а там надо видеть каждую звезду.
export type RendererOptions = { labelAll?: boolean };

export function createRenderer(
	canvas: HTMLCanvasElement,
	handlers: RendererHandlers,
	options: RendererOptions = {},
) {
	const ctx = canvas.getContext('2d', { alpha: false })!;
	const camera = new Camera();
	let scene: Scene = emptyScene();
	let reduced = prefersReducedMotion();

	let dpr = window.devicePixelRatio || 1;
	let cssWidth = 0;
	let cssHeight = 0;

	let edgeMode: EdgeMode = 'glow';
	let selectedId: string | null = null;
	let hoveredId: string | null = null;
	// Плавность подсветки: 0 — обычное небо, 1 — всё лишнее притушено.
	let highlight = 0;

	let running = true;
	let last = performance.now();
	let firstFit = true;

	// Перетаскивание звезды и затухающая болтанка после него.
	let grab: Grab = null;
	let wobbling = false;

	// ── Размер канваса и devicePixelRatio ────────────────────────────────
	function resize(): void {
		const rect = canvas.getBoundingClientRect();
		const nextDpr = window.devicePixelRatio || 1;
		if (rect.width === cssWidth && rect.height === cssHeight && nextDpr === dpr) return;

		cssWidth = rect.width;
		cssHeight = rect.height;
		if (nextDpr !== dpr) {
			dpr = nextDpr;
			// Спрайты свечения нарисованы под конкретную плотность пикселей.
		}
		canvas.width = Math.round(cssWidth * dpr);
		canvas.height = Math.round(cssHeight * dpr);
		camera.setViewport(cssWidth, cssHeight);
		camera.updateLimits(scene.bounds);
	}

	// ── Данные ───────────────────────────────────────────────────────────
	function setGraph(graph: Graph): void {
		scene = syncScene(scene, graph, performance.now());
		camera.updateLimits(scene.bounds);
		if (firstFit && scene.stars.size > 0) {
			firstFit = false;
			camera.fit(scene.bounds);
			// Своя звезда — в центре экрана при первом открытии.
			const mine = scene.stars.get(scene.me);
			if (mine) camera.flyTo(mine.toX, mine.toY, camera.zoom, 1);
		}
	}

	function setSelection(id: string | null): void {
		selectedId = id;
	}

	function setEdgeMode(mode: EdgeMode): void {
		edgeMode = mode;
	}

	function focusOn(id: string, zoom?: number): void {
		const star = scene.stars.get(id);
		if (!star) return;
		camera.flyTo(star.toX, star.toY, zoom ?? Math.max(camera.zoom, 1.4));
	}

	// ── Позиция звезды с учётом дрейфа ───────────────────────────────────
	function livePosition(star: Star, now: number): { x: number; y: number } {
		const base = starPosition(star, now);
		if (reduced) return { x: base.x + star.ox, y: base.y + star.oy };
		const t = now / 1000;
		return {
			x: base.x + star.ox + star.amp * Math.sin(star.freqX * t + star.phaseX),
			y: base.y + star.oy + star.amp * Math.sin(star.freqY * t + star.phaseY),
		};
	}

	// Проекция на экран с учётом глубины. Ближние звёзды отходят от центра
	// экрана сильнее дальних — при панорамировании это и даёт объём.
	// Множитель scale — во сколько раз рисовать размеры этой звезды.
	function project(star: Star, now: number): { sx: number; sy: number; scale: number } {
		const position = livePosition(star, now);
		const scale = camera.zoom * (1 + star.depth * DEPTH_STRENGTH);
		return {
			sx: cssWidth / 2 + (position.x - camera.x) * scale,
			sy: cssHeight / 2 + (position.y - camera.y) * scale,
			scale,
		};
	}

	// Обратный перевод: куда в мире попадает палец, если целиться
	// в звезду на её глубине.
	function screenToWorldAtDepth(
		screenX: number,
		screenY: number,
		depth: number,
	): { x: number; y: number } {
		const scale = camera.zoom * (1 + depth * DEPTH_STRENGTH);
		return {
			x: (screenX - cssWidth / 2) / scale + camera.x,
			y: (screenY - cssHeight / 2) / scale + camera.y,
		};
	}

	// Вспышка новой звезды: 0 → 1.8× → 1× за 900 мс.
	function appearScale(star: Star, now: number): number {
		if (star.appearAt === null) return 1;
		const t = (now - star.appearAt) / APPEAR_DURATION;
		if (t >= 1) {
			star.appearAt = null;
			return 1;
		}
		if (reduced) return 1;
		if (t < 0.4) return easeOutBack(clamp01(t / 0.4)) * 1.8;
		return 1.8 + (1 - 1.8) * easeInOutCubic(clamp01((t - 0.4) / 0.6));
	}

	// ── Хит-тест: линейный перебор, при n ≤ 200 это дёшево ───────────────
	// Считаем в экранных пикселях: из-за глубины у каждой звезды свой масштаб,
	// и сравнивать мировые расстояния между ними уже нельзя.
	function pickStar(screenX: number, screenY: number): Star | null {
		const now = performance.now();
		let best: { star: Star; distance: number } | null = null;

		for (const star of scene.stars.values()) {
			const { sx, sy, scale } = project(star, now);
			const distance = Math.hypot(sx - screenX, sy - screenY);
			const reach = Math.max(star.radius * scale + HIT_PAD_WORLD * scale, HIT_PAD_MIN_SCREEN);
			if (distance > reach) continue;
			if (!best || distance < best.distance) best = { star, distance };
		}
		return best?.star ?? null;
	}

	function pickAt(screenX: number, screenY: number): Pick {
		const star = pickStar(screenX, screenY);
		if (star) return { kind: 'node', id: star.id };

		const inviter = scene.stars.get(scene.me);
		const depth = inviter?.depth ?? 0;
		const scale = camera.zoom * (1 + depth * DEPTH_STRENGTH);
		for (const dot of scene.invites) {
			const sx = cssWidth / 2 + (dot.x - camera.x) * scale;
			const sy = cssHeight / 2 + (dot.y - camera.y) * scale;
			if (Math.hypot(sx - screenX, sy - screenY) <= HIT_PAD_MIN_SCREEN) {
				return { kind: 'invite', id: dot.id };
			}
		}
		return { kind: 'empty' };
	}

	// ── Отрисовка ────────────────────────────────────────────────────────
	function draw(now: number): void {
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

		drawBackground();
		drawDust();
		drawNebulae();

		const neighbours = selectedId ? scene.neighbours.get(selectedId) : undefined;
		const isLit = (id: string): boolean =>
			!selectedId || id === selectedId || (neighbours?.has(id) ?? false);

		drawEdges(now, isLit);
		drawInvites(now);
		drawCorona(now, isLit);
		drawCores(now, isLit);
		drawLabels(now, isLit);
	}

	function drawBackground(): void {
		const gradient = ctx.createLinearGradient(0, 0, 0, cssHeight);
		gradient.addColorStop(0, SKY_TOP);
		gradient.addColorStop(0.55, SKY_MID);
		gradient.addColorStop(1, SKY_BOTTOM);
		ctx.fillStyle = gradient;
		ctx.fillRect(0, 0, cssWidth, cssHeight);
	}

	function drawDust(): void {
		const tile = dustTile();
		const pattern = ctx.createPattern(tile, 'repeat');
		if (!pattern) return;

		// Пыль движется с параллаксом: медленнее звёзд, поэтому кажется дальше.
		const offsetX = -((camera.x * camera.zoom * DUST_PARALLAX) % DUST_TILE_SIZE);
		const offsetY = -((camera.y * camera.zoom * DUST_PARALLAX) % DUST_TILE_SIZE);

		if (tuning.dustAlpha <= 0) return;

		ctx.save();
		ctx.translate(offsetX, offsetY);
		ctx.fillStyle = pattern;
		// Выше единицы прозрачность уже не поднять, поэтому плотность набираем
		// повторными проходами: два прохода — вдвое гуще.
		ctx.globalAlpha = Math.min(1, tuning.dustAlpha);
		const width = cssWidth + DUST_TILE_SIZE * 2;
		const height = cssHeight + DUST_TILE_SIZE * 2;
		for (let pass = tuning.dustAlpha; pass > 0; pass -= 1) {
			ctx.globalAlpha = Math.min(1, pass);
			ctx.fillRect(-offsetX - DUST_TILE_SIZE, -offsetY - DUST_TILE_SIZE, width, height);
		}
		ctx.restore();
	}

	// Две очень тусклые туманности: небо должно остаться тёмным.
	function drawNebulae(): void {
		const radius = Math.max(cssWidth, cssHeight) * 0.4;
		const spots: [number, number, string][] = [
			[-420, -260, '#1B2A55'],
			[380, 300, '#3A1E44'],
		];
		ctx.save();
		for (const [worldX, worldY, color] of spots) {
			const x = camera.worldToScreenX(worldX);
			const y = camera.worldToScreenY(worldY);
			const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
			gradient.addColorStop(0, `${color}1A`);
			gradient.addColorStop(1, `${color}00`);
			ctx.fillStyle = gradient;
			ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
		}
		ctx.restore();
	}

	// Устойчивое число в [0,1) из id звезды: фазы колебаний должны быть
	// у каждой свои, но одинаковые при каждом заходе.
	function fraction(id: string, salt: number): number {
		let hash = 2166136261 ^ Math.imul(salt, 0x9e3779b1);
		for (let i = 0; i < id.length; i += 1) {
			hash ^= id.charCodeAt(i);
			hash = Math.imul(hash, 16777619);
		}
		return ((hash >>> 0) % 10000) / 10000;
	}

	// Насколько сильно связь изгибается у своего конца.
	function bendAmount(star: Star, length: number, now: number, salt: number): number {
		if (reduced) return 0;
		const energy = Math.min(BEND_MAX, BEND_BASE + BEND_PER_LINK * star.node.degree);
		const period =
			BEND_PERIOD[0] + (BEND_PERIOD[1] - BEND_PERIOD[0]) * fraction(star.id, salt);
		const phase = fraction(star.id, salt + 11) * Math.PI * 2;
		return length * energy * Math.sin((now / 1000) * ((Math.PI * 2) / period) + phase);
	}

	// Точка на кубической кривой — нужна, чтобы импульс бежал именно по связи,
	// а не по прямой между звёздами.
	function bezier(
		t: number,
		p0: number,
		c1: number,
		c2: number,
		p1: number,
	): number {
		const u = 1 - t;
		return u * u * u * p0 + 3 * u * u * t * c1 + 3 * u * t * t * c2 + t * t * t * p1;
	}

	// Яркость вдоль линии: у концов — плато, дальше обрыв. Обрыв, а не плавный
	// спуск: иначе вместо звёзд с лучами получается всё та же паутина,
	// только тусклее.
	function edgeGradient(
		x1: number,
		y1: number,
		x2: number,
		y2: number,
		a: Star,
		b: Star,
		length: number,
		reachA: number,
		reachB: number,
		near: number,
		far: number,
	): CanvasGradient | string {
		const gradient = ctx.createLinearGradient(x1, y1, x2, y2);

		// Сплошной режим и случай, когда звёзды и так рядом, — светится
		// вся линия целиком.
		if (edgeMode === 'full' || length < 1 || reachA + reachB >= length) {
			gradient.addColorStop(0, rgba(a.halo, near));
			gradient.addColorStop(1, rgba(b.halo, near));
			return gradient;
		}

		const endA = reachA / length;
		const endB = 1 - reachB / length;

		gradient.addColorStop(0, rgba(a.halo, near));
		// Плато держим до двух третей досягаемости, потом резкий спуск.
		gradient.addColorStop(endA * 0.66, rgba(a.halo, near * 0.85));
		gradient.addColorStop(endA, rgba(a.halo, far));
		gradient.addColorStop(endB, rgba(b.halo, far));
		gradient.addColorStop(endB + (1 - endB) * 0.34, rgba(b.halo, near * 0.85));
		gradient.addColorStop(1, rgba(b.halo, near));
		return gradient;
	}

	// Ближний к звезде кусок связи: короткая дуга той же формы, но толще
	// и ярче. Возвращает 1, если нарисовали, — для счётчика.
	function drawFlare(
		x1: number,
		y1: number,
		x2: number,
		y2: number,
		nx: number,
		ny: number,
		bend: number,
		star: Star,
		scale: number,
		reach: number,
		alpha: number,
	): number {
		const width = star.radius * scale * FLARE_WIDTH;
		if (reach < FLARE_MIN_SCREEN || width < 0.9) return 0;

		const length = Math.hypot(x2 - x1, y2 - y1);
		if (length < 1) return 0;

		// Доля связи, которую занимает огрызок, и та же кривизна, что у линии.
		const t = Math.min(0.5, reach / length);
		const ex = x1 + (x2 - x1) * t;
		const ey = y1 + (y2 - y1) * t;
		const cx = x1 + (x2 - x1) * t * 0.5 + nx * bend * t * 1.5;
		const cy = y1 + (y2 - y1) * t * 0.5 + ny * bend * t * 1.5;

		const gradient = ctx.createLinearGradient(x1, y1, ex, ey);
		gradient.addColorStop(0, rgba(star.halo, alpha * 0.9));
		gradient.addColorStop(0.55, rgba(star.halo, alpha * 0.4));
		gradient.addColorStop(1, rgba(star.halo, 0));

		ctx.save();
		ctx.lineWidth = width;
		ctx.lineCap = 'round';
		ctx.strokeStyle = gradient;
		ctx.beginPath();
		ctx.moveTo(x1, y1);
		ctx.quadraticCurveTo(cx, cy, ex, ey);
		ctx.stroke();
		ctx.restore();
		return 1;
	}

	function drawEdges(now: number, isLit: (id: string) => boolean): void {
		if (EDGES_HIDDEN) return;
		ctx.save();
		ctx.globalCompositeOperation = 'lighter';
		ctx.lineWidth = 0.8;
		let flares = 0;

		for (const [a, b] of scene.edges) {
			const pa = project(a, now);
			const pb = project(b, now);
			let x1 = pa.sx;
			let y1 = pa.sy;
			let x2 = pb.sx;
			let y2 = pb.sy;

			// Линия к только что зажёгшейся звезде прочерчивается за 400 мс.
			const fresh = a.appearAt !== null ? a : b.appearAt !== null ? b : null;
			if (fresh) {
				const progress = clamp01((now - (fresh.appearAt ?? now)) / DRAW_EDGE_MS);
				if (fresh === b) {
					x2 = x1 + (x2 - x1) * progress;
					y2 = y1 + (y2 - y1) * progress;
				} else {
					x1 = x2 + (x1 - x2) * progress;
					y1 = y2 + (y1 - y2) * progress;
				}
			}

			const incident =
				selectedId !== null && (a.id === selectedId || b.id === selectedId);
			const both = isLit(a.id) && isLit(b.id);
			// Выбранную звезду и её соседей показываем целиком: там связи
			// важнее красоты, их нужно видеть по всей длине.
			const base = edgeMode === 'full' ? EDGE_ALPHA_PLAIN : EDGE_ALPHA_NEAR;
			const near = incident ? 0.5 : both ? base : base * (1 - 0.65 * highlight);
			const far = incident ? 0.5 : EDGE_ALPHA_FAR;

			const length = Math.hypot(x2 - x1, y2 - y1);
			const reachA = a.radius * pa.scale * EDGE_GLOW_RADII;
			const reachB = b.radius * pb.scale * EDGE_GLOW_RADII;

			ctx.strokeStyle = edgeGradient(x1, y1, x2, y2, a, b, length, reachA, reachB, near, far);

			// Изгиб: контрольные точки отходят от прямой в разные стороны,
			// поэтому связь выходит из звезды дугой и так же входит в другую.
			const nx = length > 0 ? -(y2 - y1) / length : 0;
			const ny = length > 0 ? (x2 - x1) / length : 0;
			// Сплошной режим и связи выбранной звезды не шевелятся: на них
			// смотрят, чтобы разобраться, кто с кем знаком, а не любоваться.
			const still = edgeMode === 'full' || incident;
			const bendA = still ? 0 : bendAmount(a, length, now, 1);
			const bendB = still ? 0 : -bendAmount(b, length, now, 2);

			const c1x = x1 + (x2 - x1) / 3 + nx * bendA;
			const c1y = y1 + (y2 - y1) / 3 + ny * bendA;
			const c2x = x1 + ((x2 - x1) * 2) / 3 + nx * bendB;
			const c2y = y1 + ((y2 - y1) * 2) / 3 + ny * bendB;

			ctx.beginPath();
			ctx.moveTo(x1, y1);
			ctx.bezierCurveTo(c1x, c1y, c2x, c2y, x2, y2);
			ctx.stroke();

			// Огрызки у звёзд — поверх тонкой линии, своей толщиной.
			if (!incident && flares < FLARE_MAX) {
				flares += drawFlare(x1, y1, x2, y2, nx, ny, bendA, a, pa.scale, reachA, near);
				flares += drawFlare(x2, y2, x1, y1, -nx, -ny, bendB, b, pb.scale, reachB, near);
			}

		}
		ctx.restore();
	}

	// Тусклая точка приглашения и пунктир к пригласившему.
	function drawInvites(now: number): void {
		if (scene.invites.length === 0) return;
		const inviter = scene.stars.get(scene.me);
		if (!inviter) return;
		const from = project(inviter, now);
		// Точки живут на глубине пригласившего — иначе пунктир к ним
		// расходился бы с его звездой при движении карты.
		const scale = camera.zoom * (1 + inviter.depth * DEPTH_STRENGTH);
		const dotX = (dot: InviteDot): number => cssWidth / 2 + (dot.x - camera.x) * scale;
		const dotY = (dot: InviteDot): number => cssHeight / 2 + (dot.y - camera.y) * scale;

		const pulse = 0.35 + 0.2 * (0.5 + 0.5 * Math.sin((now / 1000) * ((Math.PI * 2) / 3)));

		ctx.save();
		ctx.setLineDash([3, 4]);
		ctx.lineWidth = 1;
		ctx.strokeStyle = rgba([0x6b, 0x72, 0x80], 0.25);
		for (const dot of scene.invites) {
			ctx.beginPath();
			ctx.moveTo(from.sx, from.sy);
			ctx.lineTo(dotX(dot), dotY(dot));
			ctx.stroke();
		}
		ctx.restore();

		ctx.save();
		ctx.fillStyle = rgba([0x9c, 0xa3, 0xaf], reduced ? 0.45 : pulse);
		for (const dot of scene.invites) {
			ctx.beginPath();
			ctx.arc(dotX(dot), dotY(dot), Math.max(2, 2.5 * scale), 0, Math.PI * 2);
			ctx.fill();
		}
		ctx.restore();
	}

	// Венец из языков пламени: сначала мягкая копия (она и есть свечение
	// звезды — отдельного ореола вокруг нет), поверх сами языки. Каждый слой
	// собирается в один путь и заливается разом: две заливки на звезду
	// вместо сотни отдельных лепестков.
	function drawCorona(now: number, isLit: (id: string) => boolean): void {
		const flame = tuning.flame;
		if (flame.alpha <= 0) return;

		ctx.save();
		ctx.globalCompositeOperation = 'lighter';

		let drawn = 0;
		// Идём от самых крупных звёзд: если упрёмся в предел, без венца
		// останется мелочь, у которой он и так почти не виден.
		for (const star of scene.byRadius) {
			if (drawn >= CORONA_MAX_STARS) break;
			if (star.node.isBlocked) continue;

			const { sx, sy, scale: depthScale } = project(star, now);
			const appear = appearScale(star, now);
			const inner = star.radius * depthScale * appear;
			const reachOut = inner * (1 + flame.length) * flame.softWidth;
			// Порог — по видимому размеру звезды вместе со свечением, а не по
			// одному радиусу: иначе на отдалённой карте пламя пропадает у всех.
			if (reachOut < CORONA_MIN_SCREEN) continue;
			if (
				sx + reachOut < 0 ||
				sx - reachOut > cssWidth ||
				sy + reachOut < 0 ||
				sy - reachOut > cssHeight
			) {
				continue;
			}
			drawn += 1;

			// Языков — по размеру звезды, помноженному на личный множитель
			// человека: он записан за ним навсегда, поэтому два одинаковых
			// по числу связей солнца всё равно горят по-своему.
			const count = Math.max(3, Math.round(tongueCount(star.radius) * star.flame * flame.tongues));
			const step = (Math.PI * 2) / count;
			const dim = isLit(star.id) ? 1 : 1 - 0.65 * highlight;
			const seed = fraction(star.id, 21);
			const turn = flame.spin > 0 ? spinAt(flame.spin, now, seed) : seed * Math.PI * 2;
			const from = inner * flame.from;
			const full = inner * (1 + flame.length);
			const wave =
				reduced || flame.flickerSpeed <= 0
					? 0
					: (now / 1000) * ((Math.PI * 2) / flame.flickerSpeed) * (0.5 + seed);

			// Длина каждого языка гуляет вокруг своей: у соседей разные фазы,
			// поэтому венец шевелится, а не пульсирует целиком.
			const reach = (i: number): number => {
				const beat = reduced
					? 1
					: 1 - flame.flicker + flame.flicker * (0.5 + 0.5 * Math.sin(wave + i * 2.7));
				return inner * (1 + flame.length * beat);
			};

			// Мягкая копия. Её можно утопить к центру целиком (softShift)
			// или начать ближе к ядру (softFrom) — так она закрывает пустое
			// место между основаниями языков и диском.
			if (flame.soft > 0) {
				const shift = inner * flame.softShift;
				const softFrom = Math.max(
					0.01,
					(flame.softFrom > 0 ? inner * flame.softFrom : from) - shift,
				);
				ctx.beginPath();
				for (let i = 0; i < count; i += 1) {
					tongue(
						sx,
						sy,
						turn + i * step,
						softFrom,
						inner + (reach(i) - inner) * flame.softWidth - shift,
						step * flame.width * flame.softWidth,
						flame.sweep,
						flame.taper,
						flame.bow,
					);
				}
				ctx.fillStyle = coronaFill(
					sx,
					sy,
					softFrom,
					inner + (full - inner) * flame.softWidth - shift,
					star.halo,
					flame.alpha * flame.soft * dim,
					flame.plateau,
				);
				ctx.fill();
			}

			ctx.beginPath();
			for (let i = 0; i < count; i += 1) {
				tongue(
					sx,
					sy,
					turn + i * step,
					from,
					reach(i),
					step * flame.width,
					flame.sweep,
					flame.taper,
					flame.bow,
				);
			}
			ctx.fillStyle = coronaFill(sx, sy, from, full, star.halo, flame.alpha * dim, flame.plateau);
			ctx.fill();
		}

		ctx.restore();
	}

	// Один язык: сужающийся к острию лепесток, подвёрнутый набок.
	function tongue(
		cx: number,
		cy: number,
		angle: number,
		from: number,
		to: number,
		width: number,
		sweep: number,
		taper: number,
		bow: number,
	): void {
		const half = width / 2;
		const tipAngle = angle + sweep;
		const mid = (from + to) / 2;
		// taper — насколько язык пузатый в середине, bow — где приходится изгиб.
		const belly = half * taper;
		const bend = sweep * bow;

		ctx.moveTo(cx + Math.cos(angle - half) * from, cy + Math.sin(angle - half) * from);
		ctx.quadraticCurveTo(
			cx + Math.cos(angle - belly + bend) * mid,
			cy + Math.sin(angle - belly + bend) * mid,
			cx + Math.cos(tipAngle) * to,
			cy + Math.sin(tipAngle) * to,
		);
		ctx.quadraticCurveTo(
			cx + Math.cos(angle + belly + bend) * mid,
			cy + Math.sin(angle + belly + bend) * mid,
			cx + Math.cos(angle + half) * from,
			cy + Math.sin(angle + half) * from,
		);
		ctx.closePath();
	}

	// Дыхание диска. corePulse — насколько сильно меняется радиус (доля
	// от него), corePulsePeriod — за сколько секунд полный вдох-выдох.
	// Ноль силы означает полную неподвижность, без всяких оговорок.
	function corePulse(star: Star, now: number): number {
		if (reduced || tuning.corePulse <= 0 || tuning.corePulsePeriod <= 0) return 1;
		const turn = (now / 1000) * ((Math.PI * 2) / tuning.corePulsePeriod);
		return 1 + tuning.corePulse * Math.sin(turn + star.twinklePhase);
	}

	// Поворот слоя. У каждой звезды своя сторона вращения — иначе всё небо
	// начинает крутиться синхронно и это сразу читается как механизм.
	function spinAt(period: number, now: number, seed: number): number {
		const start = seed * Math.PI * 2;
		if (reduced) return start;
		return (now / 1000) * ((Math.PI * 2) / period) * (seed < 0.5 ? 1 : -1) + start;
	}

	// Сколько языков у звезды такого радиуса: прямая через две точки
	// CORONA_TONGUES_AT с ограничителями по краям.
	function tongueCount(radius: number): number {
		const [small, big] = CORONA_TONGUES_AT;
		const t = (radius - small.radius) / (big.radius - small.radius);
		const raw = small.tongues + (big.tongues - small.tongues) * t;
		return Math.min(CORONA_TONGUES_MAX, Math.max(CORONA_TONGUES_MIN, Math.round(raw)));
	}

	// Заливка венца: у основания плотная, к остриям сходит на нет.
	function coronaFill(
		cx: number,
		cy: number,
		from: number,
		to: number,
		color: RGB,
		alpha: number,
		plateau: number,
	): CanvasGradient {
		const gradient = ctx.createRadialGradient(cx, cy, from * 0.5, cx, cy, to);
		gradient.addColorStop(0, rgba(color, alpha));
		gradient.addColorStop(Math.min(0.99, Math.max(0.01, plateau)), rgba(color, alpha * 0.6));
		gradient.addColorStop(1, rgba(color, 0));
		return gradient;
	}

	function drawCores(now: number, isLit: (id: string) => boolean): void {
		for (const star of scene.order) {
			const { sx: x, sy: y, scale: depthScale } = project(star, now);
			const scale = appearScale(star, now);
			const radius = Math.max(
				0.7,
				star.radius * depthScale * scale * tuning.coreSize * corePulse(star, now),
			);
			if (x + radius < 0 || x - radius > cssWidth || y + radius < 0 || y - radius > cssHeight)
				continue;

			const dim = isLit(star.id) ? 1 : 1 - 0.65 * highlight;
			ctx.globalAlpha = star.node.isBlocked ? 0.35 * dim : dim;

			if (star.node.isBlocked || radius < CORE_GRADIENT_MIN) {
				ctx.fillStyle = star.node.isBlocked ? rgb(star.halo) : CORE;
				ctx.beginPath();
				ctx.arc(x, y, radius, 0, Math.PI * 2);
				ctx.fill();
			} else {
				// Ореол за краем диска — до самого пламени. Рисуем первым,
				// чтобы диск лёг поверх и край остался чётким.
				ctx.save();
				ctx.globalCompositeOperation = 'lighter';
				const edge = radius * (1 + tuning.coreGlow);
				const glow = ctx.createRadialGradient(x, y, radius * 0.92, x, y, edge);
				glow.addColorStop(0, rgba(star.halo, tuning.coreGlowAlpha * dim));
				glow.addColorStop(1, rgba(star.halo, 0));
				ctx.fillStyle = glow;
				ctx.beginPath();
				ctx.arc(x, y, edge, 0, Math.PI * 2);
				ctx.fill();
				ctx.restore();

				// Сам диск: середина держит еле-синий цвет, у кромки резко
				// выходит в белый. Держим цвет до coreSharp доли кромки,
				// а весь переход укладываем в оставшуюся полоску.
				const centre = mix(CORE_RGB, star.halo, tuning.coreTint);
				const hold = tuning.coreRim * tuning.coreSharp;
				const disc = ctx.createRadialGradient(x, y, 0, x, y, radius);
				disc.addColorStop(0, rgb(centre));
				disc.addColorStop(hold, rgb(centre));
				disc.addColorStop(tuning.coreRim, CORE);
				disc.addColorStop(1, CORE);
				ctx.fillStyle = disc;
				ctx.beginPath();
				ctx.arc(x, y, radius, 0, Math.PI * 2);
				ctx.fill();
			}

			// Выбранную звезду обводим тонким кольцом — чтобы было видно,
			// о ком карточка в углу.
			if (star.id === selectedId) {
				ctx.globalAlpha = 0.8;
				ctx.strokeStyle = rgba(star.halo, 0.9);
				ctx.lineWidth = 1;
				ctx.beginPath();
				ctx.arc(x, y, radius + 6, 0, Math.PI * 2);
				ctx.stroke();
			}
		}
		ctx.globalAlpha = 1;
	}

	// Подписи появляются только вблизи и только у заметных звёзд: иначе небо
	// превращается в свалку (раздел 8.6).
	function drawLabels(now: number, isLit: (id: string) => boolean): void {
		if (camera.zoom < LABEL_ZOOM && !options.labelAll) return;

		ctx.save();
		ctx.font = '11px -apple-system, "Segoe UI", Roboto, sans-serif';
		ctx.textAlign = 'center';
		ctx.textBaseline = 'top';
		ctx.shadowColor = 'rgba(4, 6, 14, 0.9)';
		ctx.shadowBlur = 4;

		for (const star of scene.order) {
			const notable =
				options.labelAll === true ||
				star.node.degree >= 4 ||
				star.id === selectedId ||
				star.id === hoveredId ||
				star.id === scene.me;
			if (!notable) continue;

			const { sx: x, sy: y, scale: depthScale } = project(star, now);
			if (x < -100 || x > cssWidth + 100 || y < -40 || y > cssHeight + 40) continue;

			ctx.globalAlpha = isLit(star.id) ? 0.75 : 0.75 * (1 - 0.65 * highlight);
			ctx.fillStyle = 'rgb(233, 240, 255)';
			ctx.fillText(star.node.name, x, y + star.radius * depthScale + 6);
		}
		ctx.restore();
		ctx.globalAlpha = 1;
	}

	// ── Цикл ─────────────────────────────────────────────────────────────
	function frame(now: number): void {
		if (!running) return;
		const dt = Math.min(0.05, (now - last) / 1000);
		last = now;

		resize();
		camera.update(dt, scene.bounds);

		// Резинки считаются, только пока есть что считать: в покое цикл
		// физики выключен и кадр стоит ровно столько же, сколько раньше.
		if (grab || wobbling) wobbling = stepWobble(scene, grab, dt);

		// Затухание неба вокруг выбранной звезды — за 200 мс.
		const target = selectedId ? 1 : 0;
		highlight += (target - highlight) * Math.min(1, dt / 0.2);

		draw(now);
		requestAnimationFrame(frame);
	}
	requestAnimationFrame(frame);

	// ── Ввод ─────────────────────────────────────────────────────────────
	const pointers = new Map<number, { x: number; y: number }>();
	let dragging = false;
	let moved = 0;
	let lastPoint = { x: 0, y: 0, t: 0 };
	let pinchDistance = 0;
	let lastTapAt = 0;
	// Скорость пальца копим сглаженно: одно событие касания даёт слишком
	// шумную оценку, и бросок получается случайным.
	let flingX = 0;
	let flingY = 0;
	// Звезда под пальцем: пока не сдвинули дальше порога — это кандидат на тап,
	// после порога — перетаскивание на резинках.
	let candidate: Star | null = null;

	function localPoint(event: PointerEvent): { x: number; y: number } {
		const rect = canvas.getBoundingClientRect();
		return { x: event.clientX - rect.left, y: event.clientY - rect.top };
	}

	function onPointerDown(event: PointerEvent): void {
		canvas.setPointerCapture(event.pointerId);
		const point = localPoint(event);
		pointers.set(event.pointerId, point);

		if (pointers.size === 2) {
			const [a, b] = [...pointers.values()];
			pinchDistance = Math.hypot(a.x - b.x, a.y - b.y);
			dragging = false;
			return;
		}

		dragging = true;
		moved = 0;
		flingX = 0;
		flingY = 0;
		candidate = pickStar(point.x, point.y);
		lastPoint = { ...point, t: performance.now() };
		camera.beginDrag();
	}

	function onPointerMove(event: PointerEvent): void {
		const point = localPoint(event);

		if (pointers.size === 2 && pointers.has(event.pointerId)) {
			pointers.set(event.pointerId, point);
			const [a, b] = [...pointers.values()];
			const distance = Math.hypot(a.x - b.x, a.y - b.y);
			if (pinchDistance > 0 && distance > 0) {
				camera.zoomAt(distance / pinchDistance, (a.x + b.x) / 2, (a.y + b.y) / 2);
			}
			pinchDistance = distance;
			return;
		}

		if (!dragging) {
			// Наведение есть только на десктопе: у пальца его не бывает.
			if (event.pointerType === 'mouse') {
				const pick = pickAt(point.x, point.y);
				const id = pick.kind === 'node' ? pick.id : null;
				if (id !== hoveredId) {
					hoveredId = id;
					handlers.onHover(id);
					canvas.style.cursor = id ? 'pointer' : 'grab';
				}
			}
			return;
		}

		const dx = point.x - lastPoint.x;
		const dy = point.y - lastPoint.y;
		moved += Math.hypot(dx, dy);

		// Палец начал с звезды и ушёл дальше порога — тащим её, а не карту.
		if (candidate && moved > TAP_SLOP) {
			if (!grab) {
				grab = { star: candidate, worldX: 0, worldY: 0 };
				camera.endDrag();
				camera.stop();
			}
			const world = screenToWorldAtDepth(point.x, point.y, candidate.depth);
			grab.worldX = world.x;
			grab.worldY = world.y;
			wobbling = true;
			lastPoint = { ...point, t: performance.now() };
			return;
		}

		camera.panBy(dx, dy);

		const now = performance.now();
		const dt = Math.max(8, now - lastPoint.t) / 1000;
		lastPoint = { ...point, t: now };

		// Копим скорость для броска, но саму инерцию не включаем: пока палец
		// на экране, карту двигает только он. Иначе движение складывается
		// с инерцией и идёт вдвое быстрее пальца — рывками.
		const weight = 0.25;
		flingX = flingX * (1 - weight) + (dx / dt) * weight;
		flingY = flingY * (1 - weight) + (dy / dt) * weight;
	}

	function onPointerUp(event: PointerEvent): void {
		const point = localPoint(event);
		pointers.delete(event.pointerId);
		if (pointers.size < 2) pinchDistance = 0;

		if (!dragging) return;
		dragging = false;
		camera.endDrag();

		// Звезду отпустили: резинки сами вернут всех по местам.
		if (grab) {
			grab = null;
			candidate = null;
			return;
		}
		candidate = null;

		if (moved > TAP_SLOP) {
			// Это было перетаскивание: отпустили — карта катится дальше.
			camera.throw(flingX, flingY);
			return;
		}
		camera.stop();

		const now = performance.now();
		const pick = pickAt(point.x, point.y);

		// Двойной тап/клик — плавно центрировать на звезде под курсором.
		if (now - lastTapAt < 320 && pick.kind === 'node') {
			focusOn(pick.id);
			lastTapAt = 0;
			return;
		}
		lastTapAt = now;
		handlers.onPick(pick);
	}

	function onWheel(event: WheelEvent): void {
		event.preventDefault();
		const rect = canvas.getBoundingClientRect();
		const factor = Math.exp(-event.deltaY * 0.0015);
		camera.zoomAt(factor, event.clientX - rect.left, event.clientY - rect.top);
	}

	const motionQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)');
	const onMotionChange = (): void => {
		reduced = prefersReducedMotion();
	};

	canvas.addEventListener('pointerdown', onPointerDown);
	canvas.addEventListener('pointermove', onPointerMove);
	canvas.addEventListener('pointerup', onPointerUp);
	canvas.addEventListener('pointercancel', onPointerUp);
	canvas.addEventListener('wheel', onWheel, { passive: false });
	motionQuery?.addEventListener('change', onMotionChange);
	canvas.style.cursor = 'grab';

	return {
		camera,
		setGraph,
		setSelection,
		setEdgeMode,
		focusOn,
		focusOnMe: () => focusOn(scene.me),
		zoomBy: (factor: number) => camera.zoomAt(factor, cssWidth / 2, cssHeight / 2),
		fit: () => camera.fit(scene.bounds),
		destroy(): void {
			running = false;
			canvas.removeEventListener('pointerdown', onPointerDown);
			canvas.removeEventListener('pointermove', onPointerMove);
			canvas.removeEventListener('pointerup', onPointerUp);
			canvas.removeEventListener('pointercancel', onPointerUp);
			canvas.removeEventListener('wheel', onWheel);
			motionQuery?.removeEventListener('change', onMotionChange);
		},
	};
}

export type Renderer = ReturnType<typeof createRenderer>;
