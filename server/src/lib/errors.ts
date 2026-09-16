// Единый формат тела ответа: { error: { code, message, field } }.
export class HttpError extends Error {
	constructor(
		public status: number,
		public code: string,
		message: string,
		public field?: string,
	) {
		super(message);
		this.name = 'HttpError';
	}
}

export class BadRequest extends HttpError {
	constructor(field: string, code: string, message: string) {
		super(400, code, message, field);
		this.name = 'BadRequest';
	}
}

export const unauthorized = () => new HttpError(401, 'unauthorized', 'Требуется вход');
export const forbidden = (message = 'Доступ закрыт') => new HttpError(403, 'forbidden', message);
export const notFound = (message = 'Не найдено') => new HttpError(404, 'not_found', message);
export const conflict = (code: string, message: string) => new HttpError(409, code, message);
export const tooMany = (message = 'Слишком часто, попробуйте позже') =>
	new HttpError(429, 'rate_limited', message);
