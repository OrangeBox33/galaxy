// Экран профиля поверх карты. При первом входе показывается сам, но его
// всегда можно пропустить — тогда звезда светится нейтрально-белым.
import { useState } from 'react';
import { AGE_MAX, AGE_MIN, type Gender } from '../../../shared/config';
import { me as meApi } from '../api/endpoints';
import { ApiError } from '../api/client';
import { useStore } from '../store';
import { Avatar } from './Avatar';

const GENDER_LABELS: { value: Gender; label: string }[] = [
	{ value: 'FEMALE', label: 'Женский' },
	{ value: 'MALE', label: 'Мужской' },
	{ value: 'UNSPECIFIED', label: 'Не указывать' },
];

export function ProfileSheet({ onClose }: { onClose: () => void }) {
	const profile = useStore((state) => state.profile);
	const setProfile = useStore((state) => state.setProfile);
	const refreshGraph = useStore((state) => state.refreshGraph);

	const [name, setName] = useState(profile?.name ?? '');
	const [age, setAge] = useState(profile?.age === null ? '' : String(profile?.age ?? ''));
	const [gender, setGender] = useState<Gender>(profile?.gender ?? 'UNSPECIFIED');
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [confirmDelete, setConfirmDelete] = useState(false);

	if (!profile) return null;

	async function save(): Promise<void> {
		setBusy(true);
		setError(null);
		try {
			const updated = await meApi.update({
				// Заблокированное админом имя не отправляем вовсе: сервер всё
				// равно ответит 403, а пользователю это ни о чём не скажет.
				...(profile!.nameLockedByAdmin ? {} : { displayName: name.trim() }),
				age: age.trim() === '' ? null : Number(age),
				gender,
			});
			setProfile(updated);
			await refreshGraph();
			onClose();
		} catch (err) {
			setError(err instanceof ApiError ? err.message : 'Не удалось сохранить');
		} finally {
			setBusy(false);
		}
	}

	async function remove(): Promise<void> {
		setBusy(true);
		try {
			await meApi.remove();
			window.location.reload();
		} catch {
			setError('Не удалось удалить профиль');
			setBusy(false);
		}
	}

	return (
		<div className="sheet">
			<div className="sheet__body">
				<div className="sheet__head">
					<Avatar name={profile.name} file={profile.avatar} gender={gender} size={64} />
					<div>
						<h2>Ваша звезда</h2>
						<p className="sheet__hint">
							Возраст и пол Telegram не передаёт — их указываете только вы.
						</p>
					</div>
				</div>

				<label className="field">
					<span>Имя</span>
					<input
						value={name}
						maxLength={32}
						disabled={profile.nameLockedByAdmin}
						onChange={(event) => setName(event.target.value)}
					/>
					{profile.nameLockedByAdmin && (
						<small>Имя изменено администратором, поменять его нельзя.</small>
					)}
				</label>

				<label className="field">
					<span>Возраст</span>
					<input
						value={age}
						inputMode="numeric"
						placeholder="не указан"
						onChange={(event) => setAge(event.target.value.replace(/\D/g, '').slice(0, 3))}
					/>
					<small>
						от {AGE_MIN} до {AGE_MAX}, можно оставить пустым
					</small>
				</label>

				<div className="field">
					<span>Пол</span>
					<div className="segmented">
						{GENDER_LABELS.map((option) => (
							<button
								key={option.value}
								className={gender === option.value ? 'segmented__item is-active' : 'segmented__item'}
								onClick={() => setGender(option.value)}
							>
								{option.label}
							</button>
						))}
					</div>
					<small>Пол даёт звезде лёгкий оттенок — тёплый или холодный.</small>
				</div>

				{error && <div className="sheet__error">{error}</div>}

				<div className="sheet__actions">
					<button className="btn" disabled={busy} onClick={() => void save()}>
						Сохранить
					</button>
					<button className="btn btn--ghost" disabled={busy} onClick={onClose}>
						Пропустить
					</button>
				</div>

				<div className="sheet__danger">
					{confirmDelete ? (
						<>
							<span>Удалить профиль вместе со всеми связями?</span>
							<button className="btn btn--danger" disabled={busy} onClick={() => void remove()}>
								Да, удалить
							</button>
							<button className="btn btn--ghost" onClick={() => setConfirmDelete(false)}>
								Отмена
							</button>
						</>
					) : (
						<button className="btn btn--quiet" onClick={() => setConfirmDelete(true)}>
							Удалить мой профиль
						</button>
					)}
				</div>
			</div>
		</div>
	);
}
