// Карточка выбранной звезды — в углу экрана (раздел 8.7). На десктопе
// фиксированная слева внизу, на мобильных — нижняя панель во всю ширину.
import { useState } from 'react';
import { useStore } from '../store';
import { invites, links } from '../api/endpoints';
import { ApiError } from '../api/client';
import { Avatar } from './Avatar';
import { openShare } from '../telegram/webapp';

type Props = {
	onEditProfile: () => void;
	onFocus: (id: string) => void;
};

export function StarCard({ onEditProfile, onFocus }: Props) {
	const graph = useStore((state) => state.graph);
	const selection = useStore((state) => state.selection);
	const select = useStore((state) => state.select);
	const refreshGraph = useStore((state) => state.refreshGraph);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	if (!graph || !selection) return null;

	const close = () => {
		setError(null);
		select(null);
	};

	async function run(action: () => Promise<unknown>): Promise<void> {
		setBusy(true);
		setError(null);
		try {
			await action();
			await refreshGraph();
		} catch (err) {
			setError(err instanceof ApiError ? err.message : 'Не получилось');
		} finally {
			setBusy(false);
		}
	}

	if (selection.kind === 'invite') {
		const invite = graph.pending.find((item) => item.id === selection.id);
		if (!invite) return null;
		const url = `https://t.me/share?startapp=${invite.token}`;
		return (
			<div className="card">
				<button className="card__close" onClick={close}>
					×
				</button>
				<div className="card__row">
					<div className="card__dot" />
					<div>
						<div className="card__name">{invite.label || 'Приглашение'}</div>
						<div className="card__meta">
							ждёт с {new Date(invite.createdAt).toLocaleDateString('ru-RU')}
						</div>
					</div>
				</div>
				<div className="card__actions">
					<button
						className="btn"
						disabled={busy}
						onClick={() => openShare(url, 'Открой ссылку, и рядом с моей звездой загорится твоя.')}
					>
						Отправить ещё раз
					</button>
					<button
						className="btn btn--ghost"
						disabled={busy}
						onClick={() => void run(() => invites.revoke(invite.id)).then(close)}
					>
						Убрать
					</button>
				</div>
				{error && <div className="card__error">{error}</div>}
			</div>
		);
	}

	const node = graph.nodes.find((item) => item.id === selection.id);
	if (!node) return null;

	const isMe = node.id === graph.me;
	const linked = graph.edges.some(
		([a, b]) => (a === graph.me && b === node.id) || (b === graph.me && a === node.id),
	);

	return (
		<div className="card">
			<button className="card__close" onClick={close}>
				×
			</button>
			<div className="card__row">
				<Avatar name={node.name} file={node.avatar} gender={node.gender} size={48} />
				<div>
					<div className="card__name" onClick={() => onFocus(node.id)}>
						{node.name}
					</div>
					<div className="card__meta">
						{node.age !== null && <span>{node.age} лет · </span>}
						<span>друзей: {node.degree}</span>
						{node.isTest && <span className="card__badge">тестовая</span>}
						{node.isBlocked && <span className="card__badge">погасла</span>}
					</div>
				</div>
			</div>

			<div className="card__actions">
				{isMe ? (
					<button className="btn" onClick={onEditProfile}>
						Редактировать профиль
					</button>
				) : linked ? (
					<button
						className="btn btn--ghost"
						disabled={busy}
						onClick={() => void run(() => links.remove(node.id))}
					>
						Развязать
					</button>
				) : (
					<button
						className="btn"
						disabled={busy || node.isBlocked}
						onClick={() => void run(() => links.create(node.id))}
					>
						Связать
					</button>
				)}
			</div>
			{error && <div className="card__error">{error}</div>}
		</div>
	);
}
