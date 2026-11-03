type ThemeParams = { bg_color?: string };

type TelegramWebApp = {
	initData: string;
	platform?: string;
	initDataUnsafe?: { user?: { id: number } };
	colorScheme?: string;
	themeParams?: ThemeParams;
	ready: () => void;
	expand: () => void;
	openTelegramLink: (url: string) => void;
	setHeaderColor?: (color: string) => void;
	setBackgroundColor?: (color: string) => void;
	disableVerticalSwipes?: () => void;
	HapticFeedback?: { impactOccurred: (style: string) => void };
};

// Мост Макса (st.max.ru/js/max-web-app.js): методов ready и expand
// в документации нет, поэтому всё необязательное.
type MaxWebApp = {
	initData: string;
	platform?: string;
	ready?: () => void;
	openLink?: (url: string) => void;
	shareMaxContent?: (params: { text?: string; link?: string }) => Promise<unknown>;
	// На десктопе и в вебе не поддерживается и отвечает отказом промиса.
	HapticFeedback?: { impactOccurred: (style: string) => Promise<unknown> | void };
};

declare global {
	interface Window {
		Telegram?: { WebApp?: TelegramWebApp };
		WebApp?: MaxWebApp;
	}
}

// Макс открывает приложение с #WebAppData=…, Telegram — с #tgWebAppData=….
// Читаем сразу: роутер или мост могут потом переписать адрес.
const maxHashData = new URLSearchParams(window.location.hash.slice(1)).get('WebAppData');

export const messenger: 'telegram' | 'max' = maxHashData ? 'max' : 'telegram';
document.documentElement.dataset.messenger = messenger;

// Мост Макса грузится только в Максе: в Telegram он лишний запрос до первого кадра.
export function loadBridge(): Promise<void> {
	if (messenger !== 'max') return Promise.resolve();
	return new Promise((resolve) => {
		const script = document.createElement('script');
		script.src = 'https://st.max.ru/js/max-web-app.js';
		script.onload = () => resolve();
		// Без моста вход всё равно состоится: initData читается из адреса.
		script.onerror = () => resolve();
		document.head.append(script);
	});
}

export function webApp(): TelegramWebApp | null {
	return window.Telegram?.WebApp ?? null;
}

function maxApp(): MaxWebApp | null {
	return messenger === 'max' ? (window.WebApp ?? null) : null;
}

export function initData(): string {
	if (messenger === 'telegram') return webApp()?.initData ?? '';
	return maxApp()?.initData || maxHashData || '';
}

export function isInsideMessenger(): boolean {
	return initData().length > 0;
}

export function platform(): string | undefined {
	return messenger === 'max' ? maxApp()?.platform : webApp()?.platform;
}

export function prepareWebApp(): void {
	if (messenger === 'max') {
		maxApp()?.ready?.();
		return;
	}
	const app = webApp();
	if (!app) return;
	app.ready();
	app.expand();
	app.setHeaderColor?.('#04060E');
	app.setBackgroundColor?.('#04060E');
	// Иначе вертикальный свайп по карте сворачивает Mini App.
	app.disableVerticalSwipes?.();
}

export function openShare(url: string, text: string): void {
	if (messenger === 'max') {
		const max = maxApp();
		if (max?.shareMaxContent) void max.shareMaxContent({ text, link: url }).catch(() => {});
		else void navigator.share?.({ text, url }).catch(() => {});
		return;
	}
	const share = `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`;
	const app = webApp();
	if (app) {
		app.openTelegramLink(share);
		return;
	}
	window.open(share, '_blank');
}

export function openTelegramProfile(username: string): void {
	const url = `https://t.me/${encodeURIComponent(username)}`;
	const max = maxApp();
	if (max?.openLink) {
		max.openLink(url);
		return;
	}
	const app = webApp();
	if (app && messenger === 'telegram') {
		app.openTelegramLink(url);
		return;
	}
	window.open(url, '_blank');
}

export function haptic(style: 'light' | 'medium' = 'light'): void {
	if (messenger === 'telegram') {
		webApp()?.HapticFeedback?.impactOccurred(style);
		return;
	}
	void Promise.resolve(maxApp()?.HapticFeedback?.impactOccurred(style)).catch(() => {});
}
