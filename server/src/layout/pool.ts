// Запуск расчёта в отдельном потоке. Поток создаётся на время расчёта
// и гасится после: пересчёты редкие (несколько раз в сутки), держать
// постоянный поток ради этого незачем, а память на сервере не резиновая.
import { Worker } from 'node:worker_threads';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeLayout, type LayoutInput, type LayoutResult } from '../../../shared/layout/index.js';
import { log } from '../lib/log.js';
import { toInput, toResponse, type WorkerRequest, type WorkerResponse } from './worker.js';

const here = dirname(fileURLToPath(import.meta.url));
const WORKER_FILE = join(here, 'worker.js');

// Расчёт не должен висеть вечно: если что-то пошло не так, лучше вернуть
// ошибку и оставить прежнюю раскладку, чем копить мёртвые потоки.
const TIMEOUT_MS = 60_000;

function toRequest(input: LayoutInput): WorkerRequest {
	return {
		ids: input.ids.map((id) => id.toString()),
		edges: input.edges,
		previous: [...(input.previous ?? new Map())].map(([id, point]) => [id.toString(), point]),
		anchors: [...(input.anchors ?? new Map())].map(([id, anchor]) => [
			id.toString(),
			anchor.toString(),
		]),
		full: input.full,
		long: input.long,
	};
}

function fromResponse(response: WorkerResponse): LayoutResult {
	return {
		nodes: response.nodes.map((node) => ({ ...node, id: BigInt(node.id) })),
		iterations: response.iterations,
	};
}

export function computeLayoutInThread(input: LayoutInput): Promise<LayoutResult> {
	return new Promise((resolve, reject) => {
		let worker: Worker;
		try {
			worker = new Worker(WORKER_FILE);
		} catch (err) {
			// Нет собранного воркера (например, запуск из исходников в тестах) —
			// считаем на месте. Результат тот же, просто основной поток занят.
			log.warn({ err }, 'поток раскладки недоступен, считаю в основном');
			resolve(computeLayout(input));
			return;
		}

		const timer = setTimeout(() => {
			void worker.terminate();
			reject(new Error('расчёт раскладки не уложился в минуту'));
		}, TIMEOUT_MS);

		const finish = (fn: () => void): void => {
			clearTimeout(timer);
			void worker.terminate();
			fn();
		};

		worker.on('message', (message: { ok: boolean; result?: WorkerResponse; error?: string }) => {
			if (message.ok && message.result) {
				const result = fromResponse(message.result);
				finish(() => resolve(result));
			} else {
				finish(() => reject(new Error(message.error ?? 'поток раскладки не справился')));
			}
		});

		worker.on('error', (err) => finish(() => reject(err)));

		worker.postMessage(toRequest(input));
	});
}

export { toInput, toResponse };
