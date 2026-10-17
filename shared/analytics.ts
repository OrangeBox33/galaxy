// Что клиент вправе прислать в /api/events, и какие уточнения у каждого события.
// Пустой список — событие без уточнения.
export const CLIENT_EVENTS = {
	star_tap: ['self', 'other'],
	card_focus: [],
	link: ['card', 'suggest'],
	unlink: [],
	suggest_shown: [],
	suggest_dismiss: [],
	color_change: ['first', 'profile'],
	profile_open: [],
	profile_save: [],
	account_delete: [],
	invite_open: [],
	invite_share: [],
	invite_copy: [],
	tool: ['find_me', 'fit', 'constellation_on', 'constellation_off'],
	gesture: ['zoom', 'pan', 'grab'],
	first_intro: [],
	first_born: [],
	first_colors: [],
	session: [],
} as const satisfies Record<string, readonly string[]>;

export type ClientEvent = keyof typeof CLIENT_EVENTS;
export type ClientDetail<T extends ClientEvent> = (typeof CLIENT_EVENTS)[T][number];

// Пишет только сервер: вход виден ему одному, а приход по ссылке случается у другого человека.
export const SERVER_EVENTS = ['visit', 'invite_arrival'] as const;

export const VISIT_SOURCES = ['link', 'notify', 'welcome', 'direct'] as const;

export const EVENTS_BATCH_MAX = 100;
export const EVENTS_FLUSH_MS = 10_000;
