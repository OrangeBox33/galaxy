// Рендер неба: один requestAnimationFrame-цикл на всё (раздел 8).
// Порядок отрисовки: фон → пыль → рёбра → ореолы → ядра → подписи.
import type { Graph } from '../api/types';
import { clamp01, easeInOutCubic, easeOutBack, prefersReducedMotion } from './animate';
import { Camera } from './camera';
import { DUST_PARALLAX, DUST_TILE_SIZE, dustTile } from './dust';
import { CORE, SKY_BOTTOM, SKY_MID, SKY_TOP, rgb, rgba } from './palette';
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
			const alpha = incident ? 0.5 : both ? 0.22 : 0.22 * (1 - 0.65 * highlight);

			const gradient = ctx.createLinearGradient(x1, y1, x2, y2);
			gradient.addColorStop(0, rgba(a.halo, alpha));
			gradient.addColorStop(1, rgba(b.halo, alpha));
			ctx.strokeStyle = gradient;
			ctx.beginPath();
			ctx.moveTo(x1, y1);
			ctx.lineTo(x2, y2);
			ctx.stroke();
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

	function drawGlows(now: number, isLit: (id: string) => boolean): void {
		ctx.save();
		ctx.globalCompositeOperation = 'lighter';

		for (const star of scene.order) {
			// У заблокированного звезда серая и без свечения.
			if (star.node.isBlocked) continue;

			const { sx: x, sy: y, scale: depthScale } = project(star, now);
			const scale = appearScale(star, now);
			const glow = star.glow * depthScale * scale;
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
