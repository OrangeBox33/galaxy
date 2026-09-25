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

export const MAX_LINKS_PER_USER = 200;

// Цвета звезды: внутренний диск и языки пламени. Кромка диска всегда белая,
// поэтому в палитре нет тёмных — на аддитивном смешении они не видны.
// Список один на клиент и сервер: сервер принимает только эти значения.
export const STAR_COLORS = [
	'#FFFFFF',
	'#CBD6FF',
	'#5AB8FF',
	'#0595F5',
	'#3FD0C9',
	'#4BD37B',
	'#B8E356',
	'#FFD166',
	'#FF9E4D',
	'#FFB3A0',
	'#FF5F5F',
	'#F27380',
	'#FF6FC1',
	'#E06BFF',
	'#A97BFF',
	'#7C8BFF',
] as const;

export type StarColor = (typeof STAR_COLORS)[number];

export const DEFAULT_CORE_COLOR: StarColor = '#FFFFFF';
export const DEFAULT_FLAME_COLOR: StarColor = '#FFFFFF';
