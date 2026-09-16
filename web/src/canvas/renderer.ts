// Рендер неба: один requestAnimationFrame-цикл на всё.
import type { Graph } from '../api/types';
import { clamp01, easeInOutCubic, easeOutBack, prefersReducedMotion } from './animate';
import { Camera } from './camera';
import { DUST_PARALLAX, DUST_TILE_SIZE, dustTile } from './dust';
import { CORE, CORE_RGB, SKY_BOTTOM, SKY_MID, SKY_TOP, mix, rgb, rgba, type RGB } from './palette';
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

// Огрызки связей складываются в несимметричное свечение: собрались соседи слева —
// звезда «светит» налево. Поэтому на общей карте связей нет, а у выбранной есть.
export const EDGES_HIDDEN = true;

// Точка зажигалась на создании ссылки, а не на отправке: факта отправки Telegram не даёт.
// Механика цела целиком и возвращается сменой флага на false.
export const INVITES_HIDDEN = true;

export type EdgeMode = 'glow' | 'full';

export type RendererHandlers = {
	onPick: (pick: Pick) => void;
	onHover: (id: string | null) => void;
};

// Ниже 14 экранных пикселей в звезду перестаёт попадать палец.
const HIT_PAD_WORLD = 8;
const HIT_PAD_MIN_SCREEN = 14;

const DEPTH_STRENGTH = 0.22;

// В мировых единицах, как звезда, и с гашением вместо экранного минимума: иначе
// на отдалённой карте серые пятна в 2 px крупнее самих звёзд.
const INVITE_DOT_WORLD = 2.5;
const INVITE_DOT_FADE_AT = 2; // экранный радиус, ниже которого точка тает
const INVITE_DOT_MIN_SCREEN = 0.4;

// Иначе длинные перемычки между далёкими звёздами затягивают небо сеткой.
const EDGE_GLOW_RADII = 2.5;
const EDGE_ALPHA_NEAR = 0.34;
const EDGE_ALPHA_FAR = 0.015;
const EDGE_ALPHA_PLAIN = 0.22;

const CORONA_TONGUES_AT = [
	{ radius: 4.0, tongues: 12 }, // звезда с одной связью
	{ radius: 12.8, tongues: 15.5 }, // звезда с 25 связями
];
const CORONA_TONGUES_MIN = 8;
const CORONA_TONGUES_MAX = 24;
const CORONA_MIN_SCREEN = 7;
const CORONA_MAX_STARS = 40;

// Личный множитель числа языков (User.flame, 0.55…1) закреплён за человеком навсегда.
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
	soft: number; // её яркость от яркости языков, 0 — нет
	softWidth: number; // во сколько раз она шире и длиннее
	softShift: number; // перенос копии к центру, в радиусах звезды
	softFrom: number; // своё начало копии; 0 — там же, где начинаются языки
};

// Мельче этого градиент не разглядеть — экономим два градиента на звезду.
const CORE_GRADIENT_MIN = 3;

// Подбирается ползунками песочницы: значения читаются каждый кадр, правка видна сразу.
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

	dustAlpha: 1.4,
};

const TAP_SLOP = 6; // пикселей: дальше это уже перетаскивание, а не тап
const LABEL_ZOOM = 1.2;

export type RendererOptions = {
	labelAll?: boolean;
	// Только для песочницы раскладки: по связям и судят, созвездие вышло или каша.
	showEdges?: boolean;
};

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
	let highlight = 0;

	let running = true;
	let last = performance.now();
	let firstFit = true;

	let grab: Grab = null;
	let wobbling = false;

	const showAllEdges = options.showEdges === true;
	const edgesHidden = EDGES_HIDDEN && !showAllEdges;

	function resize(): void {
		const rect = canvas.getBoundingClientRect();
		const nextDpr = window.devicePixelRatio || 1;
		if (rect.width === cssWidth && rect.height === cssHeight && nextDpr === dpr) return;

		cssWidth = rect.width;
		cssHeight = rect.height;
		if (nextDpr !== dpr) {
			dpr = nextDpr;
		}
		canvas.width = Math.round(cssWidth * dpr);
		canvas.height = Math.round(cssHeight * dpr);
		camera.setViewport(cssWidth, cssHeight);
		camera.updateLimits(scene.bounds);
	}

	function setGraph(graph: Graph): void {
		scene = syncScene(scene, graph, performance.now());
		camera.updateLimits(scene.bounds);
		if (firstFit && scene.stars.size > 0) {
			firstFit = false;
			camera.fit(scene.bounds);
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

	function livePosition(star: Star, now: number): { x: number; y: number } {
		const base = starPosition(star, now);
		if (reduced) return { x: base.x + star.ox, y: base.y + star.oy };
		const t = now / 1000;
		return {
			x: base.x + star.ox + star.amp * Math.sin(star.freqX * t + star.phaseX),
			y: base.y + star.oy + star.amp * Math.sin(star.freqY * t + star.phaseY),
		};
	}

	function project(star: Star, now: number): { sx: number; sy: number; scale: number } {
		const position = livePosition(star, now);
		const scale = camera.zoom * (1 + star.depth * DEPTH_STRENGTH);
		return {
			sx: cssWidth / 2 + (position.x - camera.x) * scale,
			sy: cssHeight / 2 + (position.y - camera.y) * scale,
			scale,
		};
	}

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

	// Меряем в экранных пикселях: из-за глубины у каждой звезды свой масштаб.
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

		if (INVITES_HIDDEN) return { kind: 'empty' };

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

		const offsetX = -((camera.x * camera.zoom * DUST_PARALLAX) % DUST_TILE_SIZE);
		const offsetY = -((camera.y * camera.zoom * DUST_PARALLAX) % DUST_TILE_SIZE);

		if (tuning.dustAlpha <= 0) return;

		ctx.save();
		ctx.translate(offsetX, offsetY);
		ctx.fillStyle = pattern;
		// Выше единицы прозрачность не поднять — набираем проходами.
		ctx.globalAlpha = Math.min(1, tuning.dustAlpha);
		const width = cssWidth + DUST_TILE_SIZE * 2;
		const height = cssHeight + DUST_TILE_SIZE * 2;
		for (let pass = tuning.dustAlpha; pass > 0; pass -= 1) {
			ctx.globalAlpha = Math.min(1, pass);
			ctx.fillRect(-offsetX - DUST_TILE_SIZE, -offsetY - DUST_TILE_SIZE, width, height);
		}
		ctx.restore();
	}

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

	function fraction(id: string, salt: number): number {
		let hash = 2166136261 ^ Math.imul(salt, 0x9e3779b1);
		for (let i = 0; i < id.length; i += 1) {
			hash ^= id.charCodeAt(i);
			hash = Math.imul(hash, 16777619);
		}
		return ((hash >>> 0) % 10000) / 10000;
	}

	// Обрыв, а не плавный спуск: иначе вместо звёзд с лучами та же паутина, только тусклее.
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

		if (edgeMode === 'full' || length < 1 || reachA + reachB >= length) {
			gradient.addColorStop(0, rgba(a.halo, near));
			gradient.addColorStop(1, rgba(b.halo, near));
			return gradient;
		}

		const endA = reachA / length;
		const endB = 1 - reachB / length;

		gradient.addColorStop(0, rgba(a.halo, near));
		gradient.addColorStop(endA * 0.66, rgba(a.halo, near * 0.85));
		gradient.addColorStop(endA, rgba(a.halo, far));
		gradient.addColorStop(endB, rgba(b.halo, far));
		gradient.addColorStop(endB + (1 - endB) * 0.34, rgba(b.halo, near * 0.85));
		gradient.addColorStop(1, rgba(b.halo, near));
		return gradient;
	}

	function drawEdges(now: number, isLit: (id: string) => boolean): void {
		if (edgesHidden && selectedId === null) return;
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

			const incident = selectedId !== null && (a.id === selectedId || b.id === selectedId);
			if (edgesHidden && !incident) continue;
			const both = isLit(a.id) && isLit(b.id);
			const base = edgeMode === 'full' ? EDGE_ALPHA_PLAIN : EDGE_ALPHA_NEAR;
			const near = incident ? 0.5 : both ? base : base * (1 - 0.65 * highlight);
			const far = incident ? 0.5 : EDGE_ALPHA_FAR;

			const length = Math.hypot(x2 - x1, y2 - y1);
			const reachA = a.radius * pa.scale * EDGE_GLOW_RADII;
			const reachB = b.radius * pb.scale * EDGE_GLOW_RADII;

			ctx.strokeStyle = edgeGradient(x1, y1, x2, y2, a, b, length, reachA, reachB, near, far);

			// Прямая: изгиб и колыхание читаются как второе, чужое свечение поверх языков.
			ctx.beginPath();
			ctx.moveTo(x1, y1);
			ctx.lineTo(x2, y2);
			ctx.stroke();
		}
		ctx.restore();
	}

	function drawInvites(now: number): void {
		if (INVITES_HIDDEN) return;
		if (scene.invites.length === 0) return;
		const inviter = scene.stars.get(scene.me);
		if (!inviter) return;
		const from = project(inviter, now);
		// На глубине пригласившего: иначе пунктир расходится с его звездой.
		const scale = camera.zoom * (1 + inviter.depth * DEPTH_STRENGTH);
		const dotX = (dot: InviteDot): number => cssWidth / 2 + (dot.x - camera.x) * scale;
		const dotY = (dot: InviteDot): number => cssHeight / 2 + (dot.y - camera.y) * scale;

		const pulse = 0.35 + 0.2 * (0.5 + 0.5 * Math.sin((now / 1000) * ((Math.PI * 2) / 3)));

		const wanted = INVITE_DOT_WORLD * scale;
		const fade = Math.min(1, wanted / INVITE_DOT_FADE_AT);
		const radius = Math.max(INVITE_DOT_MIN_SCREEN, wanted);

		ctx.save();
		ctx.setLineDash([3, 4]);
		ctx.lineWidth = 1;
		ctx.strokeStyle = rgba([0x6b, 0x72, 0x80], 0.25 * fade);
		for (const dot of scene.invites) {
			ctx.beginPath();
			ctx.moveTo(from.sx, from.sy);
			ctx.lineTo(dotX(dot), dotY(dot));
			ctx.stroke();
		}
		ctx.restore();

		ctx.save();
		ctx.fillStyle = rgba([0x9c, 0xa3, 0xaf], (reduced ? 0.45 : pulse) * fade);
		for (const dot of scene.invites) {
			ctx.beginPath();
			ctx.arc(dotX(dot), dotY(dot), radius, 0, Math.PI * 2);
			ctx.fill();
		}
		ctx.restore();
	}

	// Один путь и одна заливка на слой: две на звезду вместо сотни лепестков.
	function drawCorona(now: number, isLit: (id: string) => boolean): void {
		const flame = tuning.flame;
		if (flame.alpha <= 0) return;

		ctx.save();
		ctx.globalCompositeOperation = 'lighter';

		let drawn = 0;
		for (const star of scene.byRadius) {
			if (drawn >= CORONA_MAX_STARS) break;
			if (star.node.isBlocked) continue;

			const { sx, sy, scale: depthScale } = project(star, now);
			const appear = appearScale(star, now);
			const inner = star.radius * depthScale * appear;
			const reachOut = inner * (1 + flame.length) * flame.softWidth;
			// Порог по видимому размеру со свечением: по одному радиусу пламя пропадало бы рано.
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

			const count = Math.max(
				3,
				Math.round(tongueCount(star.radius) * star.flame * flame.tongues),
			);
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

			const reach = (i: number): number => {
				const beat = reduced
					? 1
					: 1 - flame.flicker + flame.flicker * (0.5 + 0.5 * Math.sin(wave + i * 2.7));
				return inner * (1 + flame.length * beat);
			};

			// Копия утоплена внутрь: так она закрывает зазор между языками и диском.
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
			ctx.fillStyle = coronaFill(
				sx,
				sy,
				from,
				full,
				star.halo,
				flame.alpha * dim,
				flame.plateau,
			);
			ctx.fill();
		}

		ctx.restore();
	}

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

	function corePulse(star: Star, now: number): number {
		if (reduced || tuning.corePulse <= 0 || tuning.corePulsePeriod <= 0) return 1;
		const turn = (now / 1000) * ((Math.PI * 2) / tuning.corePulsePeriod);
		return 1 + tuning.corePulse * Math.sin(turn + star.twinklePhase);
	}

	// Сторона вращения своя у каждой звезды: иначе небо крутится синхронно, как механизм.
	function spinAt(period: number, now: number, seed: number): number {
		const start = seed * Math.PI * 2;
		if (reduced) return start;
		return (now / 1000) * ((Math.PI * 2) / period) * (seed < 0.5 ? 1 : -1) + start;
	}

	function tongueCount(radius: number): number {
		const [small, big] = CORONA_TONGUES_AT;
		const t = (radius - small.radius) / (big.radius - small.radius);
		const raw = small.tongues + (big.tongues - small.tongues) * t;
		return Math.min(CORONA_TONGUES_MAX, Math.max(CORONA_TONGUES_MIN, Math.round(raw)));
	}

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
				// До диска, чтобы он лёг поверх и край остался чётким.
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
		}
		ctx.globalAlpha = 1;
	}

	// Только вблизи и у заметных: иначе небо превращается в свалку.
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

	function frame(now: number): void {
		if (!running) return;
		const dt = Math.min(0.05, (now - last) / 1000);
		last = now;

		resize();
		camera.update(dt, scene.bounds);

		if (grab || wobbling) wobbling = stepWobble(scene, grab, dt);

		const target = selectedId ? 1 : 0;
		highlight += (target - highlight) * Math.min(1, dt / 0.2);

		draw(now);
		requestAnimationFrame(frame);
	}
	requestAnimationFrame(frame);

	const pointers = new Map<number, { x: number; y: number }>();
	let dragging = false;
	let moved = 0;
	let lastPoint = { x: 0, y: 0, t: 0 };
	let pinchDistance = 0;
	let lastTapAt = 0;
	let flingX = 0;
	let flingY = 0;
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

		// Пока палец на экране, карту двигает только он: инерция — уже после отпускания.
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

		if (grab) {
			grab = null;
			candidate = null;
			return;
		}
		candidate = null;

		if (moved > TAP_SLOP) {
			camera.throw(flingX, flingY);
			return;
		}
		camera.stop();

		const now = performance.now();
		const pick = pickAt(point.x, point.y);

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
		// Экранные координаты звезды для окна «возможных друзей»: оно живёт вне канвы, а искре
		// надо долететь до настоящей точки. null — звезды в сцене нет; за краем экрана
		// координата честная, решение «лететь в ту сторону» принимает вызывающий.
		screenOf(id: string): { x: number; y: number; radius: number } | null {
			const star = scene.stars.get(id);
			if (!star) return null;
			const { sx, sy, scale } = project(star, performance.now());
			const rect = canvas.getBoundingClientRect();
			return { x: rect.left + sx, y: rect.top + sy, radius: star.radius * scale };
		},
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
