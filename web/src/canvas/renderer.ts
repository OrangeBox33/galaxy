// Рендер неба: один requestAnimationFrame-цикл на всё (раздел 8).
// Порядок отрисовки: фон → пыль → рёбра → ореолы → ядра → подписи.
import type { Graph } from '../api/types';
import { clamp01, easeInOutCubic, easeOutBack, prefersReducedMotion } from './animate';
import { Camera } from './camera';
import { DUST_PARALLAX, DUST_TILE_SIZE, dustTile } from './dust';
import { CORE, SKY_BOTTOM, SKY_MID, SKY_TOP, rgb, rgba, type RGB } from './palette';
import { glowSprite, resetSprites } from './sprites';
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

// ── Корона ─────────────────────────────────────────────────────────────
// Вокруг звезды — венец из языков пламени: плотный слой коротких у самого ядра
// и длинные сужающиеся поверх. Языки мерцают по длине и слегка подвёрнуты
// в одну сторону, отчего венец кажется вращающимся потоком. Чем больше связей,
// тем языков больше и тем они длиннее.
const CORONA_MIN_SCREEN = 7; // короче этого в пикселях венец не рисуем: не разглядеть
const CORONA_TONGUES = [14, 44]; // языков при минимуме и максимуме связей
const CORONA_DEGREE_FULL = 26; // при скольких связях венец в полную силу
const CORONA_LENGTH = 0.6; // длина языка от радиуса свечения
const CORONA_SWEEP = 0.16; // подворот языка, радианы
const CORONA_SPIN = 90; // секунд на полный оборот венца
const CORONA_FLICKER = [1.7, 3.1]; // секунды на цикл мерцания
// Больше этого числа венцов за кадр не рисуем: при сильном приближении
// их место занимают самые крупные звёзды, а мелочь обходится ореолом.
const CORONA_MAX_STARS = 40;

// По связи бегут импульсы света — от звезды к звезде. Видно их только там,
// где связь светится, поэтому импульс словно вырывается из одной звезды
// и спустя мгновение прилетает во вторую.
const PULSE_MIN_DEGREE = 3; // ниже этого звезде нечего излучать
const PULSE_PERIOD = [2.4, 4.6]; // секунды на пробег
const PULSE_SIZE = 1.5; // экранных пикселей при одной связи

const TAP_SLOP = 6; // пикселей: дальше это уже перетаскивание, а не тап
const LABEL_ZOOM = 1.2;

export function createRenderer(canvas: HTMLCanvasElement, handlers: RendererHandlers) {
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
			resetSprites(dpr);
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

	function twinkle(star: Star, now: number): number {
		if (reduced) return 1;
		return 1 + 0.1 * Math.sin(star.twinkleFreq * (now / 1000) + star.twinklePhase);
	}

	// Дыхание ореола: чем больше связей, тем заметнее звезда пульсирует.
	// Одиночка на краю почти не шевелится, хаб — ощутимо.
	function breath(star: Star, now: number): number {
		if (reduced) return 1;
		const power = Math.min(1, star.node.degree / 18);
		const period = 4 + 6 * fraction(star.id, 7);
		return 1 + 0.16 * power * Math.sin((now / 1000) * ((Math.PI * 2) / period) + star.twinklePhase);
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
		drawGlows(now, isLit);
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

		ctx.save();
		ctx.translate(offsetX, offsetY);
		ctx.fillStyle = pattern;
		ctx.fillRect(-offsetX - DUST_TILE_SIZE, -offsetY - DUST_TILE_SIZE, cssWidth + DUST_TILE_SIZE * 2, cssHeight + DUST_TILE_SIZE * 2);
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

	// Импульс света, бегущий по связи. Чем больше связей у звезды, тем чаще
	// и крупнее импульсы: поток энергии виден прямо на карте.
	function drawPulse(
		now: number,
		a: Star,
		b: Star,
		x1: number,
		y1: number,
		c1x: number,
		c1y: number,
		c2x: number,
		c2y: number,
		x2: number,
		y2: number,
		length: number,
		reachA: number,
		reachB: number,
		near: number,
	): void {
		if (reduced) return;

		const degree = Math.max(a.node.degree, b.node.degree);
		if (degree < PULSE_MIN_DEGREE || length < 4) return;

		// Импульс летит от той звезды, что мощнее.
		const forward = a.node.degree >= b.node.degree;
		const key = forward ? a.id + b.id : b.id + a.id;
		const period =
			PULSE_PERIOD[0] + (PULSE_PERIOD[1] - PULSE_PERIOD[0]) * fraction(key, 3);
		const progress = ((now / 1000 / period) + fraction(key, 4)) % 1;
		const t = forward ? progress : 1 - progress;

		// Видно импульс только там, где светится сама связь: в середине
		// он гаснет и появляется снова уже у второй звезды.
		const fromStart = t * length;
		const fromEnd = (1 - t) * length;
		const visible = Math.max(
			1 - fromStart / Math.max(1, reachA),
			1 - fromEnd / Math.max(1, reachB),
		);
		if (visible <= 0) return;

		const px = bezier(t, x1, c1x, c2x, x2);
		const py = bezier(t, y1, c1y, c2y, y2);
		const size = PULSE_SIZE * (1 + Math.min(1.4, degree * 0.05)) * Math.max(0.6, camera.zoom);

		ctx.fillStyle = rgba(forward ? a.halo : b.halo, Math.min(0.85, near * 2.2 * visible));
		ctx.beginPath();
		ctx.arc(px, py, size * visible, 0, Math.PI * 2);
		ctx.fill();
	}

	function drawEdges(now: number, isLit: (id: string) => boolean): void {
		ctx.save();
		ctx.globalCompositeOperation = 'lighter';
		ctx.lineWidth = 0.8;

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

			const both = isLit(a.id) && isLit(b.id);
			const incident =
				selectedId !== null && (a.id === selectedId || b.id === selectedId);
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
			const bendA = bendAmount(a, length, now, 1);
			const bendB = -bendAmount(b, length, now, 2);

			const c1x = x1 + (x2 - x1) / 3 + nx * bendA;
			const c1y = y1 + (y2 - y1) / 3 + ny * bendA;
			const c2x = x1 + ((x2 - x1) * 2) / 3 + nx * bendB;
			const c2y = y1 + ((y2 - y1) * 2) / 3 + ny * bendB;

			ctx.beginPath();
			ctx.moveTo(x1, y1);
			ctx.bezierCurveTo(c1x, c1y, c2x, c2y, x2, y2);
			ctx.stroke();

			drawPulse(now, a, b, x1, y1, c1x, c1y, c2x, c2y, x2, y2, length, reachA, reachB, near);
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

	// Венец из языков пламени. Все языки одного слоя собираются в один путь
	// и заливаются разом: две заливки на звезду вместо сотни.
	function drawCorona(now: number, isLit: (id: string) => boolean): void {
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
			const glow = star.glow * depthScale * appear * breath(star, now);
			if (glow < CORONA_MIN_SCREEN) continue;
			if (sx + glow < 0 || sx - glow > cssWidth || sy + glow < 0 || sy - glow > cssHeight) {
				continue;
			}
			drawn += 1;

			const power = Math.min(1, star.node.degree / CORONA_DEGREE_FULL);
			const count = Math.round(
				CORONA_TONGUES[0] + (CORONA_TONGUES[1] - CORONA_TONGUES[0]) * power,
			);
			const step = (Math.PI * 2) / count;
			const inner = star.radius * depthScale * appear;
			const length = glow * CORONA_LENGTH * (0.5 + 0.5 * power);
			const dim = isLit(star.id) ? 1 : 1 - 0.65 * highlight;
			const seed = fraction(star.id, 21);

			// Венец медленно поворачивается, у каждой звезды со своей скоростью
			// и в свою сторону — иначе всё небо начинает вращаться синхронно.
			const spin = reduced
				? seed * Math.PI * 2
				: (now / 1000) * ((Math.PI * 2) / CORONA_SPIN) * (seed < 0.5 ? 1 : -1) +
					seed * Math.PI * 2;

			const period = CORONA_FLICKER[0] + (CORONA_FLICKER[1] - CORONA_FLICKER[0]) * seed;
			const phase = reduced ? 0 : (now / 1000) * ((Math.PI * 2) / period);

			// Длинные языки. Три несовпадающие гармоники дают неровное,
			// «живое» мерцание, но разброс длин остаётся умеренным.
			ctx.beginPath();
			for (let i = 0; i < count; i += 1) {
				const flicker =
					0.72 +
					0.16 * Math.sin(phase + i * 2.399) +
					0.09 * Math.sin(phase * 1.7 + i * 1.117) +
					0.05 * Math.sin(phase * 0.55 + i * 0.71);
				tongue(
					sx,
					sy,
					spin + i * step,
					inner * 0.8,
					inner + length * flicker,
					step * 0.85,
					CORONA_SWEEP,
				);
			}
			ctx.fillStyle = coronaFill(sx, sy, inner * 0.8, inner + length, star.halo, 0.34 * dim);
			ctx.fill();

			// Плотный слой коротких языков у самого ядра, подвёрнутых в другую
			// сторону: он и создаёт ощущение кипящей поверхности.
			ctx.beginPath();
			for (let i = 0; i < count; i += 1) {
				const flicker = 0.6 + 0.4 * Math.sin(phase * 1.3 + i * 2.7);
				tongue(
					sx,
					sy,
					spin + i * step + step * 0.5,
					inner * 0.45,
					inner + length * 0.3 * flicker,
					step * 0.95,
					-CORONA_SWEEP * 0.7,
				);
			}
			ctx.fillStyle = coronaFill(
				sx,
				sy,
				inner * 0.45,
				inner + length * 0.3,
				star.halo,
				0.5 * dim,
			);
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
	): void {
		const half = width / 2;
		const tipAngle = angle + sweep;
		const mid = (from + to) / 2;

		ctx.moveTo(cx + Math.cos(angle - half) * from, cy + Math.sin(angle - half) * from);
		ctx.quadraticCurveTo(
			cx + Math.cos(angle - half * 0.3 + sweep * 0.45) * mid,
			cy + Math.sin(angle - half * 0.3 + sweep * 0.45) * mid,
			cx + Math.cos(tipAngle) * to,
			cy + Math.sin(tipAngle) * to,
		);
		ctx.quadraticCurveTo(
			cx + Math.cos(angle + half * 0.3 + sweep * 0.45) * mid,
			cy + Math.sin(angle + half * 0.3 + sweep * 0.45) * mid,
			cx + Math.cos(angle + half) * from,
			cy + Math.sin(angle + half) * from,
		);
		ctx.closePath();
	}

	// Заливка венца: у основания плотная, к остриям сходит на нет.
	function coronaFill(
		cx: number,
		cy: number,
		from: number,
		to: number,
		color: RGB,
		alpha: number,
	): CanvasGradient {
		const gradient = ctx.createRadialGradient(cx, cy, from * 0.5, cx, cy, to);
		gradient.addColorStop(0, rgba(color, alpha));
		gradient.addColorStop(0.45, rgba(color, alpha * 0.6));
		gradient.addColorStop(1, rgba(color, 0));
		return gradient;
	}

	function drawGlows(now: number, isLit: (id: string) => boolean): void {
		ctx.save();
		ctx.globalCompositeOperation = 'lighter';

		for (const star of scene.order) {
			// У заблокированного звезда серая и без свечения.
			if (star.node.isBlocked) continue;

			const { sx: x, sy: y, scale: depthScale } = project(star, now);
			const scale = appearScale(star, now);
			const glow = star.glow * depthScale * scale * breath(star, now);
			if (glow < 0.5) continue;
			if (x + glow < 0 || x - glow > cssWidth || y + glow < 0 || y - glow > cssHeight) continue;

			const dim = isLit(star.id) ? 1 : 1 - 0.65 * highlight;
			// Дальние звёзды тусклее ближних — вторая половина ощущения объёма.
			const depthDim = 0.72 + 0.28 * (1 + star.depth * DEPTH_STRENGTH);
			ctx.globalAlpha = Math.min(1, star.bright * twinkle(star, now) * dim * depthDim);

			const { sprite, spriteRadius } = glowSprite(
				star.node.gender,
				star.node.isBlocked,
				star.halo,
				glow,
				dpr,
			);
			void spriteRadius;
			ctx.drawImage(sprite, x - glow, y - glow, glow * 2, glow * 2);
		}

		ctx.globalAlpha = 1;
		ctx.restore();
	}

	function drawCores(now: number, isLit: (id: string) => boolean): void {
		for (const star of scene.order) {
			const { sx: x, sy: y, scale: depthScale } = project(star, now);
			const scale = appearScale(star, now);
			const radius = Math.max(0.7, star.radius * depthScale * scale * 0.5);
			if (x + radius < 0 || x - radius > cssWidth || y + radius < 0 || y - radius > cssHeight)
				continue;

			const dim = isLit(star.id) ? 1 : 1 - 0.65 * highlight;
			ctx.globalAlpha = star.node.isBlocked ? 0.35 * dim : dim;
			ctx.fillStyle = star.node.isBlocked ? rgb(star.halo) : CORE;
			ctx.beginPath();
			ctx.arc(x, y, radius, 0, Math.PI * 2);
			ctx.fill();

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
		if (camera.zoom < LABEL_ZOOM) return;

		ctx.save();
		ctx.font = '11px -apple-system, "Segoe UI", Roboto, sans-serif';
		ctx.textAlign = 'center';
		ctx.textBaseline = 'top';
		ctx.shadowColor = 'rgba(4, 6, 14, 0.9)';
		ctx.shadowBlur = 4;

		for (const star of scene.order) {
			const notable =
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
