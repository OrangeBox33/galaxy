import {
	EVENTS_BATCH_MAX,
	EVENTS_FLUSH_MS,
	type ClientDetail,
	type ClientEvent,
} from '../../shared/analytics';
import { apiUrl } from './api/client';

type Item = { type: ClientEvent; detail?: string; value?: number };

let queue: Item[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let started = false;
let visibleSince = Date.now();
const seen = new Set<string>();

export function track<T extends ClientEvent>(type: T, detail?: ClientDetail<T>): void {
	queue.push(detail === undefined ? { type } : { type, detail });
	schedule();
}

// Раз за загрузку страницы: жесты и показы подсказок интересны как «было», а не счётом.
export function trackOnce<T extends ClientEvent>(key: string, type: T, detail?: ClientDetail<T>): void {
	if (seen.has(key)) return;
	seen.add(key);
	track(type, detail);
}

// Таймер ставится первым событием и ждёт полные 10 с: следующий появится
// только после отправки, поэтому чаще запросы не уходят.
function schedule(): void {
	if (!started || timer !== null || queue.length === 0) return;
	timer = setTimeout(() => {
		timer = null;
		void send();
	}, EVENTS_FLUSH_MS);
}

function take(): Item[] {
	if (timer !== null) clearTimeout(timer);
	timer = null;
	const batch = queue.slice(0, EVENTS_BATCH_MAX);
	queue = queue.slice(EVENTS_BATCH_MAX);
	return batch;
}

async function send(): Promise<void> {
	const batch = take();
	if (batch.length === 0) return;
	try {
		const res = await fetch(apiUrl('/events'), {
			method: 'POST',
			credentials: 'include',
			keepalive: true,
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ events: batch }),
		});
		// 4xx не повторяем: та же пачка упадёт снова.
		if (res.status >= 500) queue = [...batch, ...queue];
	} catch {
		queue = [...batch, ...queue];
	}
	schedule();
}

// Сворачивание может оказаться закрытием: хвост уходит сразу, мимо 10-секундного шага.
function sendNow(): void {
	while (queue.length > 0) {
		const body = new Blob([JSON.stringify({ events: take() })], { type: 'application/json' });
		if (!navigator.sendBeacon?.(apiUrl('/events'), body)) {
			void fetch(apiUrl('/events'), { method: 'POST', credentials: 'include', keepalive: true, body });
		}
	}
}

function closeSession(): void {
	const now = Date.now();
	const seconds = Math.round((now - visibleSince) / 1000);
	visibleSince = now;
	if (seconds > 0) queue.push({ type: 'session', value: seconds });
}

// Удаление аккаунта гасит куку и строку: пачка обязана дойти раньше него.
export async function flushBeforeLogout(): Promise<void> {
	closeSession();
	while (queue.length > 0) {
		const before = queue.length;
		await send();
		if (queue.length >= before) return;
	}
}

// До входа сервер ответил бы 401: события копятся и ждут его.
export function startAnalytics(): void {
	if (started) return;
	started = true;
	visibleSince = Date.now();
	schedule();

	document.addEventListener('visibilitychange', () => {
		if (document.visibilityState === 'hidden') {
			closeSession();
			sendNow();
		} else {
			visibleSince = Date.now();
		}
	});
}
