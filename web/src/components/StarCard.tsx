import { useMemo, useState } from 'react';
import type { Gender } from '../../../shared/config';
import { mutualFriends, neighbourMap, shortestPath } from '../../../shared/path';
import { playLink } from '../sound';
import { useStore } from '../store';
import { invites } from '../api/endpoints';
import { ApiError } from '../api/client';
import { Avatar } from './Avatar';
import { openShare } from '../telegram/webapp';

function years(n: number) {
	const tens = n % 100;
	if (tens >= 11 && tens <= 14) return 'лет';
	const ones = n % 10;
	if (ones === 1) return 'год';
	if (ones >= 2 && ones <= 4) return 'года';
	return 'лет';
}

function GenderMark({ gender }: { gender: Gender }) {
	if (gender === 'UNSPECIFIED') return null;
	const male = gender === 'MALE';
	return (
		<svg
			className="card__gender"
			viewBox="0 0 8 10"
			width="8"
			height="10"
			style={{ color: male ? 'rgba(154, 196, 255, 0.9)' : 'rgba(255, 146, 154, 0.9)' }}
			aria-label={male ? 'мужчина' : 'женщина'}
		>
			<polygon
				points={male ? '0.8,0.8 7.2,0.8 4,9.2' : '4,0.8 0.8,9.2 7.2,9.2'}
				fill="none"
				stroke="currentColor"
				strokeWidth="1.4"
				strokeLinejoin="round"
			/>
		</svg>
	);
}

function handshakes(steps: number): string {
	const tens = steps % 100;
	const ones = steps % 10;
	if (tens >= 11 && tens <= 14) return 'рукопожатий';
	if (ones === 1) return 'рукопожатие';
	if (ones >= 2 && ones <= 4) return 'рукопожатия';
	return 'рукопожатий';
}

type Props = {
	onEditProfile: () => void;
	onFocus: (id: string) => void;
};

export function StarCard({ onEditProfile, onFocus }: Props) {
	const graph = useStore((state) => state.graph);
	const selection = useStore((state) => state.selection);
	const select = useStore((state) => state.select);
	const refreshGraph = useStore((state) => state.refreshGraph);
	const linkWith = useStore((state) => state.linkWith);
	const unlinkFrom = useStore((state) => state.unlinkFrom);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const neighbours = useMemo(() => neighbourMap(graph?.edges ?? []), [graph?.edges]);

	if (!graph || !selection) return null;

	const close = () => {
		setError(null);
		select(null);
	};

	async function run(action: () => Promise<unknown>, refresh = true): Promise<void> {
		setBusy(true);
		setError(null);
		try {
			await action();
			if (refresh) await refreshGraph();
		} catch (err) {
			setError(err instanceof ApiError ? err.message : 'Не получилось');
		} finally {
			setBusy(false);
		}
	}

	if (selection.kind === 'invite') {
		const invite = graph.pending.find((item) => item.id === selection.id);
		if (!invite) return null;
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
						onClick={() =>
							openShare(
								invite.url,
								'Открой ссылку, и рядом с моей звездой зажжётся твоя.',
							)
						}
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
	const myDegree = graph.nodes.find((item) => item.id === graph.me)?.degree ?? 0;
	const linked = graph.edges.some(
		([a, b]) => (a === graph.me && b === node.id) || (b === graph.me && a === node.id),
	);
	const chain = isMe ? null : shortestPath(neighbours, graph.me, node.id);
	const mutual = isMe ? 0 : mutualFriends(neighbours, graph.me, node.id);

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
						{node.gender !== 'UNSPECIFIED' && (
							<span>
								<GenderMark gender={node.gender} /> ·{' '}
							</span>
						)}
						{node.age !== null && <span>{node.age} {years(node.age)} · </span>}
						<span>связей: {node.degree}</span>
						{node.isTest && <span className="card__badge">тестовая</span>}
						{node.isBlocked && <span className="card__badge">погасла</span>}
					</div>
					{!isMe && (
						<div className="card__meta">
							{chain
								? `${chain.length - 1} ${handshakes(chain.length - 1)}`
								: 'пока не связаны'}
							{mutual > 0 && <span> · общих друзей: {mutual}</span>}
						</div>
					)}
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
						onClick={() => void run(() => unlinkFrom(node.id), false)}
					>
						Развязать
					</button>
				) : (
					<button
						className="btn"
						disabled={busy || node.isBlocked}
						onClick={() => {
							playLink(myDegree, node.degree);
							void run(() => linkWith(node.id), false);
						}}
					>
						Связать
					</button>
				)}
			</div>
			{error && <div className="card__error">{error}</div>}
		</div>
	);
}
