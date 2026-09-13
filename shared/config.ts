// Общие константы клиента и сервера. Единственный источник истины для подпути,
// под которым живёт приложение: он протянут через vite base, роутер, куку,
// монтирование express-роутера и адрес вебхука.
export const BASE_PATH = '/galaxy';

// Имя сессионной куки. Кука ограничена Path=BASE_PATH, чтобы не утекать
// в соседние приложения того же домена.
export const SESSION_COOKIE = 'gx_session';

// Срок жизни сессии, 30 дней.
export const SESSION_MAX_AGE_SEC = 30 * 24 * 60 * 60;

// Как часто клиент перезапрашивает граф. WebSocket и SSE намеренно не используются.
export const GRAPH_POLL_MS = 30_000;

// Пол пользователя. Значения совпадают с enum Gender в Prisma.
export const GENDERS = ['MALE', 'FEMALE', 'UNSPECIFIED'] as const;
export type Gender = (typeof GENDERS)[number];

// Границы полей профиля (раздел 5 ТЗ). Нужны и серверу для валидации,
// и клиенту для подсказок в форме.
export const NAME_MIN = 1;
export const NAME_MAX = 32;
export const AGE_MIN = 5;
export const AGE_MAX = 120;

// Лимиты графа (раздел 6 ТЗ).
export const MAX_PENDING_INVITES = 50;
export const MAX_LINKS_PER_USER = 200;
