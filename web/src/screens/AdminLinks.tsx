import { useEffect, useState } from 'react';
import { admin } from '../api/endpoints';
import { ApiError } from '../api/client';
import { Avatar } from '../components/Avatar';
import type { AdminLink } from '../api/types';

const DATE = new Intl.DateTimeFormat('ru', {
	day: 'numeric',
	month: 'short',
	hour: '2-digit',
	minute: '2-digit',
});

export function AdminLinks({
	userId,
	onChanged,
	onClose,
}: {
	userId: string;
	onChanged: () => Promise<void>;
	onClose: () => void;
}) {
	const [rows, setRows] = useState<AdminLink[] | null>(null);
	const [cut, setCut] = useState<Set<string>>(new Set());
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);

	async function load(): Promise<void> {
		setRows(await admin.userLinks(userId));
		setCut(new Set());
	}

	useEffect(() => {
		void load();
	}, [userId]);

	function toggle(otherId: string): void {
		setCut((current) => {
			const next = new Set(current);
			if (next.has(otherId)) next.delete(otherId);
			else next.add(otherId);
			return next;
		});
	}

	async function save(): Promise<void> {
		setSaving(true);
		try {
			await admin.removeLinks(userId, [...cut]);
			setError(null);
			await load();
			await onChanged();
		} catch (err) {
			setError(err instanceof ApiError ? err.message : 'Не удалось разорвать связи');
		} finally {
			setSaving(false);
		}
	}

	if (rows === null) return <>загружаю…</>;

	return (
		<div className="unlink">
			{rows.length === 0 ? (
				<div className="unlink__empty">связей нет</div>
			) : (
				<div className="unlink__list">
					{rows.map((link) => (
						<label
							key={link.id}
							className={`unlink__row${cut.has(link.otherId) ? ' unlink__row--cut' : ''}`}
						>
							<input
								type="checkbox"
								checked={!cut.has(link.otherId)}
								onChange={() => toggle(link.otherId)}
							/>
							<Avatar
								name={link.otherName}
								file={link.otherAvatar}
								gender={link.otherGender}
								size={24}
							/>
							<span className="unlink__name">{link.otherName}</span>
							<span className="unlink__date">{DATE.format(new Date(link.createdAt))}</span>
						</label>
					))}
				</div>
			)}
			{error && <div className="admin__error">{error}</div>}
			<div className="unlink__bar">
				{rows.length > 0 && (
					<button
						className="btn btn--ghost"
						onClick={() =>
							setCut(
								cut.size === rows.length
									? new Set()
									: new Set(rows.map((link) => link.otherId)),
							)
						}
					>
						{cut.size === rows.length ? 'Отметить все' : 'Снять все'}
					</button>
				)}
				<button
					className="btn btn--danger"
					disabled={cut.size === 0 || saving}
					onClick={() => void save()}
				>
					{saving ? 'Разрываю…' : `Разорвать ${cut.size}`}
				</button>
				<button className="btn btn--ghost" onClick={onClose}>
					Закрыть
				</button>
			</div>
		</div>
	);
}
