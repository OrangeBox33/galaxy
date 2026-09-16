// Ссылка одна и навсегда: каждый пришедший связывается с её хозяином.
import { useState } from 'react';
import { useStore } from '../store';
import { openShare } from '../telegram/webapp';

export function InviteSheet({ onClose }: { onClose: () => void }) {
	const profile = useStore((state) => state.profile);
	const [copied, setCopied] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const url = profile?.inviteUrl ?? null;
	const shareText = profile?.shareText ?? '';

	async function copy(): Promise<void> {
		if (!url) return;
		try {
			await navigator.clipboard.writeText(url);
			setCopied(true);
		} catch {
			setError('Скопировать не вышло — выделите ссылку вручную');
		}
	}

	return (
		<div className="sheet">
			<div className="sheet__body">
				<h2>Позвать друзей</h2>

				{!url ? (
					<p className="sheet__hint">Ссылка ещё не готова — зайдите ещё раз.</p>
				) : (
					<>
						<p className="sheet__hint">{shareText}</p>
						<div className="linkbox">{url}</div>
						<small className="sheet__note">
							Это ваша постоянная ссылка. Отправляйте её кому угодно и сколько угодно
							раз: каждый, кто откроет её и войдёт, станет звездой рядом с вашей.
						</small>
						{error && <div className="sheet__error">{error}</div>}
						<div className="sheet__actions">
							<button className="btn" onClick={() => openShare(url, shareText)}>
								Отправить друзьям
							</button>
							<button className="btn btn--ghost" onClick={() => void copy()}>
								{copied ? 'Скопировано' : 'Скопировать ссылку'}
							</button>
							<button className="btn btn--quiet" onClick={onClose}>
								Готово
							</button>
						</div>
					</>
				)}
			</div>
		</div>
	);
}
