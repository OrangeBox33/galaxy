// «Позвать друга»: создаёт приглашение и отдаёт готовую ссылку с текстом.
import { useState } from 'react';
import { invites } from '../api/endpoints';
import { ApiError } from '../api/client';
import { useStore } from '../store';
import { openShare } from '../telegram/webapp';
import type { CreatedInvite } from '../api/types';

export function InviteSheet({ onClose }: { onClose: () => void }) {
	const refreshGraph = useStore((state) => state.refreshGraph);
	const [label, setLabel] = useState('');
	const [created, setCreated] = useState<CreatedInvite | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [copied, setCopied] = useState(false);

	async function create(): Promise<void> {
		setBusy(true);
		setError(null);
		try {
			const invite = await invites.create(label.trim() || undefined);
			setCreated(invite);
			await refreshGraph();
		} catch (err) {
			setError(err instanceof ApiError ? err.message : 'Не удалось создать приглашение');
		} finally {
			setBusy(false);
		}
	}

	async function copy(): Promise<void> {
		if (!created) return;
		try {
			await navigator.clipboard.writeText(created.url);
			setCopied(true);
		} catch {
			setError('Скопировать не вышло — выделите ссылку вручную');
		}
	}

	return (
		<div className="sheet">
			<div className="sheet__body">
				<h2>Позвать друга</h2>

				{!created ? (
					<>
						<label className="field">
							<span>Подпись для себя</span>
							<input
								value={label}
								maxLength={64}
								placeholder="Вася с работы"
								onChange={(event) => setLabel(event.target.value)}
							/>
							<small>
								Видите её только вы: рядом с вашей звездой появится тусклая точка,
								пока друг не зашёл.
							</small>
						</label>
						{error && <div className="sheet__error">{error}</div>}
						<div className="sheet__actions">
							<button className="btn" disabled={busy} onClick={() => void create()}>
								Создать ссылку
							</button>
							<button className="btn btn--ghost" onClick={onClose}>
								Закрыть
							</button>
						</div>
					</>
				) : (
					<>
						<p className="sheet__hint">{created.shareText}</p>
						<div className="linkbox">{created.url}</div>
						{error && <div className="sheet__error">{error}</div>}
						<div className="sheet__actions">
							<button className="btn" onClick={() => openShare(created.url, created.shareText)}>
								Отправить другу
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
