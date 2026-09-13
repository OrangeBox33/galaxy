// Камера (раздел 8.5). Хранит точку мира, оказавшуюся в центре экрана,
// и масштаб. Зум 1 — одна мировая единица на один CSS-пиксель.
import { approach, easeInOutCubic } from './animate';

export type Bounds = { minX: number; minY: number; maxX: number; maxY: number };

const MAX_ZOOM = 4;
const INERTIA_DECAY = 0.92; // за кадр при 60 fps (раздел 8.5)

export class Camera {
	x = 0;
	y = 0;
	zoom = 1;

	// Скорость инерции в экранных пикселях в секунду.
	private vx = 0;
	private vy = 0;

	// Нижняя граница зума считается от размера неба: карту всегда должно быть
	// видно целиком. ТЗ задаёт диапазон 0.35–4, но он верен лишь для неба
	// размером с экран; на карте в 2000 единиц «целиком» — это меньше 0.35.
	private minZoom = 0.05;

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
		this.x = (bounds.minX + bounds.maxX) / 2;
		this.y = (bounds.minY + bounds.maxY) / 2;
		this.flight = null;
	}

	// Границы зума пересчитываются при изменении размера окна и неба,
	// но текущий масштаб при этом не трогаем — иначе карта прыгнет под рукой.
	updateLimits(bounds: Bounds): void {
		this.minZoom = Math.min(this.zoom, this.fitZoom(bounds) * 0.8);
	}

	panBy(dxScreen: number, dyScreen: number): void {
		this.x -= dxScreen / this.zoom;
		this.y -= dyScreen / this.zoom;
		this.flight = null;
	}

	// Инерция после отпускания: скорость затухает с коэффициентом 0.92 за кадр.
	throw(vxScreen: number, vyScreen: number): void {
		this.vx = vxScreen;
		this.vy = vyScreen;
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
		const next = Math.min(MAX_ZOOM, Math.max(this.minZoom, this.zoom * factor));
		if (next === this.zoom) return;

		this.zoom = next;
		this.x = worldX - (screenX - this.viewWidth / 2) / this.zoom;
		this.y = worldY - (screenY - this.viewHeight / 2) / this.zoom;
		this.flight = null;
	}

	// Плавный перелёт к точке: двойной тап по звезде и кнопка «найти меня».
	flyTo(worldX: number, worldY: number, zoom?: number, duration = 600): void {
		this.stop();
		this.flight = {
			fromX: this.x,
			fromY: this.y,
			toX: worldX,
			toY: worldY,
			fromZoom: this.zoom,
			toZoom: Math.min(MAX_ZOOM, Math.max(this.minZoom, zoom ?? this.zoom)),
			start: performance.now(),
			duration,
		};
	}

	update(dt: number, bounds: Bounds): void {
		if (this.flight) {
			const t = Math.min(1, (performance.now() - this.flight.start) / this.flight.duration);
			const k = easeInOutCubic(t);
			this.x = this.flight.fromX + (this.flight.toX - this.flight.fromX) * k;
			this.y = this.flight.fromY + (this.flight.toY - this.flight.fromY) * k;
			this.zoom = this.flight.fromZoom + (this.flight.toZoom - this.flight.fromZoom) * k;
			if (t >= 1) this.flight = null;
		} else if (this.vx !== 0 || this.vy !== 0) {
			this.panBy(this.vx * dt, this.vy * dt);
			// 0.92 за кадр при 60 fps — переводим в затухание за секунду,
			// чтобы инерция не зависела от частоты кадров.
			const decay = INERTIA_DECAY ** (dt * 60);
			this.vx *= decay;
			this.vy *= decay;
			if (Math.hypot(this.vx, this.vy) < 4) this.stop();
		}

		this.clamp(bounds, dt);
	}

	// Панорамирование ограничено границами графа с запасом 30%.
	// Возврат мягкий: резкая остановка на границе ощущается как поломка.
	private clamp(bounds: Bounds, dt: number): void {
		const marginX = (bounds.maxX - bounds.minX) * 0.3;
		const marginY = (bounds.maxY - bounds.minY) * 0.3;
		const minX = bounds.minX - marginX;
		const maxX = bounds.maxX + marginX;
		const minY = bounds.minY - marginY;
		const maxY = bounds.maxY + marginY;

		const targetX = Math.min(maxX, Math.max(minX, this.x));
		const targetY = Math.min(maxY, Math.max(minY, this.y));
		if (targetX !== this.x || targetY !== this.y) {
			this.x = approach(this.x, targetX, 12, dt);
			this.y = approach(this.y, targetY, 12, dt);
			this.stop();
		}
	}
}
