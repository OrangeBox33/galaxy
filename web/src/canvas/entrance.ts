// Первый вход: небо целиком, наплыв, пока сервер ищет место, подлёт и рождение.
// Один код на приложение и песочницу рождения (web/birth.html).
import { starRadius } from '../../../shared/layout/params';
import { playBirth } from '../sound';
import type { Renderer } from './renderer';

export const entranceTuning = {
	skyMs: 1000, // небо целиком видно не меньше этого, даже если место нашлось раньше
	driftZoom: 1.25, // наплыв, пока ждём сервер (0.6–2 с)
	driftMs: 4000,
	flyMs: 1800, // подлёт к месту
	pauseMs: 250,
	radiusPx: 64, // экранный радиус звезды при рождении
	// Окна первого входа занимают низ экрана: поднимаем звезду над ними, иначе она
	// окажется ровно на кромке панели.
	lift: 0.22,
};

const wait = (ms: number) => new Promise((done) => setTimeout(done, ms));

export async function overview(renderer: Renderer): Promise<void> {
	// Размер канвы рендерер узнаёт в кадре: до него подгонка сводит небо в точку.
	await new Promise(requestAnimationFrame);
	renderer.fit();
	const camera = renderer.camera;
	camera.flyTo(
		camera.x,
		camera.y,
		camera.zoom * entranceTuning.driftZoom,
		entranceTuning.driftMs,
	);
}

export async function awaitSpot<T>(spot: Promise<T>): Promise<T> {
	const [found] = await Promise.all([spot, wait(entranceTuning.skyMs)]);
	return found;
}

export async function flyAndIgnite(
	renderer: Renderer,
	id: string,
	spot: { x: number; y: number },
	degree: number,
): Promise<void> {
	const { flyMs, pauseMs, radiusPx, lift } = entranceTuning;
	renderer.camera.flyTo(spot.x, spot.y, radiusPx / starRadius(degree), flyMs);
	await wait(flyMs + pauseMs);
	// Звук сам отмеряет до вспышки по birthTuning, поэтому зовётся вплотную к ignite.
	playBirth(degree);
	await renderer.ignite(id);

	const camera = renderer.camera;
	camera.flyTo(spot.x, spot.y + (camera.viewHeight * lift) / camera.zoom, camera.zoom, 450);
}
