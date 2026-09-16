// Единственный источник истины для подпути: vite base, роутер, кука,
// монтирование express-роутера и адрес вебхука берут его отсюда.
export const BASE_PATH = '/galaxy';

export const SESSION_COOKIE = 'gx_session';

export const SESSION_MAX_AGE_SEC = 30 * 24 * 60 * 60;

export const GRAPH_POLL_MS = 30_000;

// Значения совпадают с enum Gender в Prisma.
export const GENDERS = ['MALE', 'FEMALE', 'UNSPECIFIED'] as const;
export type Gender = (typeof GENDERS)[number];

export const NAME_MIN = 1;
export const NAME_MAX = 32;
export const AGE_MIN = 5;
export const AGE_MAX = 120;

export const MAX_PENDING_INVITES = 50;
export const MAX_LINKS_PER_USER = 200;
