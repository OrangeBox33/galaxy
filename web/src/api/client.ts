// Единственная точка сборки URL. Захардкоженных «/api/...» в коде быть не должно:
// приложение живёт под подпутём, и любой абсолютный путь мимо него попадёт
// в соседнее приложение домена (раздел 2.2 ТЗ).
import { BASE_PATH } from '../../../shared/config';

export function apiUrl(path: string): string {
	return `${BASE_PATH}/api${path}`;
}

export function assetUrl(path: string): string {
	return `${BASE_PATH}/${path.replace(/^\//, '')}`;
}

export type ApiErrorBody = {
	error: { code: string; message: string; field?: string };
};

export class ApiError extends Error {
	constructor(
		public status: number,
		public code: string,
		message: string,
		public field?: string,
	) {
		super(message);
		this.name = 'ApiError';
	}
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
	const res = await fetch(apiUrl(path), {
		method,
		// Сессия живёт в httpOnly-куке, без credentials её не пошлют.
		credentials: 'include',
		headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
		body: body === undefined ? undefined : JSON.stringify(body),
	});

	if (!res.ok) {
		let payload: ApiErrorBody | null = null;
		try {
			payload = (await res.json()) as ApiErrorBody;
		} catch {
			payload = null;
		}
		throw new ApiError(
			res.status,
			payload?.error.code ?? 'http_error',
			payload?.error.message ?? `Ошибка ${res.status}`,
			payload?.error.field,
		);
	}

	if (res.status === 204) return undefined as T;
	return (await res.json()) as T;
}

export const api = {
	get: <T>(path: string) => request<T>('GET', path),
	post: <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
	patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body ?? {}),
	del: <T>(path: string, body?: unknown) => request<T>('DELETE', path, body),
};
