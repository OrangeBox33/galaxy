import { useEffect, useState } from 'react';
import { BASE_PATH } from '../../shared/config';
import { auth } from './api/endpoints';
import { ApiError } from './api/client';
import { useStore } from './store';
import { initData, isInsideTelegram, prepareWebApp } from './telegram/webapp';
import { Sky } from './screens/Sky';
import { Admin } from './screens/Admin';

type Phase = { kind: 'loading' } | { kind: 'ready' } | { kind: 'error'; message: string };

function currentRoute(): string {
	const path = window.location.pathname;
	const trimmed = path.startsWith(BASE_PATH) ? path.slice(BASE_PATH.length) : path;
	return trimmed.replace(/\/+$/, '') || '/';
}

export function App() {
	const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
	const [route, setRoute] = useState(currentRoute);
	const setProfile = useStore((state) => state.setProfile);

	useEffect(() => {
		const onPop = () => setRoute(currentRoute());
		window.addEventListener('popstate', onPop);
		return () => window.removeEventListener('popstate', onPop);
	}, []);

	useEffect(() => {
		prepareWebApp();

		if (!isInsideTelegram()) {
			setPhase({
				kind: 'error',
				message: 'Откройте карту через Telegram — вход работает только внутри него.',
			});
			return;
		}

		auth.telegram(initData())
			.then((profile) => {
				setProfile(profile);
				setPhase({ kind: 'ready' });
			})
			.catch((err: unknown) => {
				const message =
					err instanceof ApiError && err.status === 403
						? 'Доступ закрыт.'
						: 'Не удалось войти. Попробуйте открыть карту заново.';
				setPhase({ kind: 'error', message });
			});
	}, [setProfile]);

	if (phase.kind === 'loading') {
		return (
			<div className="boot">
				<h1>Galaxy</h1>
				<p>зажигаю звёзды…</p>
			</div>
		);
	}

	if (phase.kind === 'error') {
		return (
			<div className="boot">
				<h1>Galaxy</h1>
				<p>{phase.message}</p>
			</div>
		);
	}

	return route === '/admin' ? <Admin onLeave={() => navigate('/')} /> : <Sky onOpenAdmin={() => navigate('/admin')} />;
}

export function navigate(path: string): void {
	window.history.pushState({}, '', `${BASE_PATH}${path === '/' ? '/' : path}`);
	window.dispatchEvent(new PopStateEvent('popstate'));
}
