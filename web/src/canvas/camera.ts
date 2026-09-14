// Камера (раздел 8.5). Хранит точку мира, оказавшуюся в центре экрана, и масштаб.
// Зум 1 — одна мировая единица на один CSS-пиксель.
//
// Камера не прыгает вслед за пальцем один в один, а догоняет цель с небольшим
// запаздыванием: палец двигает цель, картинка подтягивается за ней. Разница
// в несколько десятков миллисекунд глазом не читается как задержка, зато
// убирает дрожь от неровного пальца и дискретности событий касания.
import { approach, easeInOutCubic } from './animate';

export type Bounds = { minX: number; minY: number; maxX: number; maxY: number };

const MAX_ZOOM = 4;

// Насколько быстро картинка догоняет цель. 14 — постоянная времени около 70 мс.
const FOLLOW_RATE = 14;

// Затухание инерции за кадр при 60 fps. В ТЗ 0.92; поднято до 0.95 по просьбе
// заказчика — прокрутка должна дольше катиться, а не вставать колом.
const INERTIA_DECAY = 0.95;

// Быстрее этого бросок не летит: рывок пальцем не должен швырять карту.
const MAX_FLING = 2600;

export class Camera {
	// То, что видно на экране.
	x = 0;
	y = 0;
	zoom = 1;

	// Куда камера едет. Палец и инерция двигают именно эту точку.
	private tx = 0;
	private ty = 0;

	// Скорость инерции в экранных пикселях в секунду.
	private vx = 0;
	private vy = 0;

	// Нижняя граница зума считается от размера неба: карту всегда должно быть
	// видно целиком. ТЗ задаёт диапазон 0.35–4, но он верен лишь для неба
	// размером с экран; на карте в 2000 единиц «целиком» — это меньше 0.35.
	private minZoom = 0.05;

	// Потолок приближения. По умолчанию из ТЗ; песочница поднимает его,
	// чтобы разглядывать одну звезду вблизи.
	maxZoom = MAX_ZOOM;

	// Пока палец на экране, к границам не притягиваем: за край можно вытащить,
	// но с сопротивлением, и после отпускания карта сама вернётся.
	private dragging = false;
	private lastBounds: Bounds = { minX: -500, minY: -500, maxX: 500, maxY: 500 };

	private flight: {
		fromX: number;
		fromY: number;
		toX: number;
		toY: number;
		fromZoom: number;
		toZoom: number;
		start: number;
		duration: number;
	} | null = null;

	constructor(
		public viewWidth = 1,
		public viewHeight = 1,
	) {}

	setViewport(width: number, height: number): void {
		this.viewWidth = width;
		this.viewHeight = height;
	}

	worldToScreenX(worldX: number): number {
		return (worldX - this.x) * this.zoom + this.viewWidth / 2;
	}

	worldToScreenY(worldY: number): number {
		return (worldY - this.y) * this.zoom + this.viewHeight / 2;
	}

	screenToWorldX(screenX: number): number {
		return (screenX - this.viewWidth / 2) / this.zoom + this.x;
	}

	screenToWorldY(screenY: number): number {
		return (screenY - this.viewHeight / 2) / this.zoom + this.y;
	}

	// Масштаб, при котором всё небо помещается на экран с запасом 30%.
	fitZoom(bounds: Bounds): number {
		const width = Math.max(1, bounds.maxX - bounds.minX) * 1.3;
		const height = Math.max(1, bounds.maxY - bounds.minY) * 1.3;
		return Math.min(this.viewWidth / width, this.viewHeight / height);
	}

	fit(bounds: Bounds): void {
		this.zoom = this.fitZoom(bounds);
		this.minZoom = this.zoom * 0.8;
		this.moveTo((bounds.minX + bounds.maxX) / 2, (bounds.minY + bounds.maxY) / 2);
		this.flight = null;
	}

	// Границы зума пересчитываются при изменении размера окна и неба,
	// но текущий масштаб при этом не трогаем — иначе карта прыгнет под рукой.
	updateLimits(bounds: Bounds): void {
		this.minZoom = Math.min(this.zoom, this.fitZoom(bounds) * 0.8);
	}

	// Мгновенный перенос без догоняния: для щипка и подгонки под экран,
	// где точка под пальцем обязана стоять как вкопанная.
	private moveTo(worldX: number, worldY: number): void {
		this.x = worldX;
		this.y = worldY;
		this.tx = worldX;
		this.ty = worldY;
	}

	beginDrag(): void {
		this.dragging = true;
		this.stop();
		// Цель подтягиваем к текущей картинке: иначе первый же кадр
		// перетаскивания дёрнет карту на остаток прежнего движения.
		this.tx = this.x;
		this.ty = this.y;
	}

	endDrag(): void {
		this.dragging = false;
	}

	panBy(dxScreen: number, dyScreen: number): void {
		const limits = this.limits(this.lastBounds);
		let stepX = dxScreen / this.zoom;
		let stepY = dyScreen / this.zoom;

		// Сопротивление за краем: карта тянется, но неохотно — так видно,
		// что дальше ничего нет, и при этом не бьёт по рукам.
		if (this.tx - stepX < limits.minX || this.tx - stepX > limits.maxX) stepX *= 0.35;
		if (this.ty - stepY < limits.minY || this.ty - stepY > limits.maxY) stepY *= 0.35;

		this.tx -= stepX;
		this.ty -= stepY;
		this.flight = null;
	}

	// Бросок после отпускания пальца.
	throw(vxScreen: number, vyScreen: number): void {
		const speed = Math.hypot(vxScreen, vyScreen);
		const scale = speed > MAX_FLING ? MAX_FLING / speed : 1;
		this.vx = vxScreen * scale;
		this.vy = vyScreen * scale;
	}

	stop(): void {
		this.vx = 0;
		this.vy = 0;
		this.flight = null;
	}

	// Зум «вокруг точки»: мировая точка под пальцем остаётся на месте.
	zoomAt(factor: number, screenX: number, screenY: number): void {
		const worldX = this.screenToWorldX(screenX);
		const worldY = this.screenToWorldY(screenY);
		const next = Math.min(this.maxZoom, Math.max(this.minZoom, this.zoom * factor));
		if (next === this.zoom) return;

		this.zoom = next;
		this.moveTo(
			worldX - (screenX - this.viewWidth / 2) / this.zoom,
			worldY - (screenY - this.viewHeight / 2) / this.zoom,
		);
		this.flight = null;
	}

	// Плавный перелёт к точке: двойной тап по звезде и кнопка «найти меня».
	flyTo(worldX: number, worldY: number, zoom?: number, duration = 700): void {
		this.stop();
		this.flight = {
			fromX: this.x,
			fromY: this.y,
			toX: worldX,
			toY: worldY,
			fromZoom: this.zoom,
			toZoom: Math.min(this.maxZoom, Math.max(this.minZoom, zoom ?? this.zoom)),
			start: performance.now(),
			duration,
		};
	}

	update(dt: number, bounds: Bounds): void {
		this.lastBounds = bounds;

		if (this.flight) {
			const t = Math.min(1, (performance.now() - this.flight.start) / this.flight.duration);
			const k = easeInOutCubic(t);
			this.moveTo(
				this.flight.fromX + (this.flight.toX - this.flight.fromX) * k,
				this.flight.fromY + (this.flight.toY - this.flight.fromY) * k,
			);
			this.zoom = this.flight.fromZoom + (this.flight.toZoom - this.flight.fromZoom) * k;
			if (t >= 1) this.flight = null;
			return;
		}

		if (this.vx !== 0 || this.vy !== 0) {
			this.panBy(this.vx * dt, this.vy * dt);
			// Затухание за кадр переводим в затухание за секунду, чтобы инерция
			// не зависела от частоты кадров.
			const decay = INERTIA_DECAY ** (dt * 60);
			this.vx *= decay;
			this.vy *= decay;
			if (Math.hypot(this.vx, this.vy) < 6) this.stop();
		}

		this.clampTarget(bounds, dt);

		// Картинка догоняет цель.
		this.x = approach(this.x, this.tx, FOLLOW_RATE, dt);
		this.y = approach(this.y, this.ty, FOLLOW_RATE, dt);
	}

	// Панорамирование ограничено границами графа с запасом 30%.
	private limits(bounds: Bounds): Bounds {
		const marginX = (bounds.maxX - bounds.minX) * 0.3;
		const marginY = (bounds.maxY - bounds.minY) * 0.3;
		return {
			minX: bounds.minX - marginX,
			maxX: bounds.maxX + marginX,
			minY: bounds.minY - marginY,
			maxY: bounds.maxY + marginY,
		};
	}

	// Возврат к границам мягкий и только после того, как палец отпущен:
	// резкая остановка под пальцем ощущается как поломка.
	private clampTarget(bounds: Bounds, dt: number): void {
		if (this.dragging) return;

		const limits = this.limits(bounds);
		const targetX = Math.min(limits.maxX, Math.max(limits.minX, this.tx));
		const targetY = Math.min(limits.maxY, Math.max(limits.minY, this.ty));
		if (targetX !== this.tx || targetY !== this.ty) {
			this.tx = approach(this.tx, targetX, 7, dt);
			this.ty = approach(this.ty, targetY, 7, dt);
			this.stop();
		}
	}
}
