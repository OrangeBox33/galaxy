// Обёртка над window.Telegram.WebApp. Всё, что знает о Telegram, живёт здесь:
// приложение должно открываться и вне Telegram (например, при отладке вёрстки),
// не падая на отсутствующем SDK.

type ThemeParams = { bg_color?: string };

type TelegramWebApp = {
	initData: string;
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

declare global {
	interface Window {
		Telegram?: { WebApp?: TelegramWebApp };
	}
}

export function webApp(): TelegramWebApp | null {
	return window.Telegram?.WebApp ?? null;
}

export function isInsideTelegram(): boolean {
	const app = webApp();
	return !!app && typeof app.initData === 'string' && app.initData.length > 0;
}

export function initData(): string {
	return webApp()?.initData ?? '';
}

// Разворачиваем окно на всю высоту и красим шапку в цвет неба, чтобы карта
// не выглядела вклеенной в чужой интерфейс.
export function prepareWebApp(): void {
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
	const share = `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`;
	const app = webApp();
	if (app) {
		app.openTelegramLink(share);
		return;
	}
	window.open(share, '_blank');
}

export function haptic(style: 'light' | 'medium' = 'light'): void {
	webApp()?.HapticFeedback?.impactOccurred(style);
}
