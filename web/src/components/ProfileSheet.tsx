import { useState } from 'react';
import {
	AGE_MAX,
	AGE_MIN,
	DEFAULT_CORE_COLOR,
	DEFAULT_FLAME_COLOR,
	STAR_COLORS,
	type Gender,
} from '../../../shared/config';
import { me as meApi } from '../api/endpoints';
import { ApiError } from '../api/client';
import { useStore } from '../store';
import { Avatar } from './Avatar';

const GENDER_LABELS: { value: Gender; label: string }[] = [
	{ value: 'FEMALE', label: 'Женский' },
	{ value: 'MALE', label: 'Мужской' },
	{ value: 'UNSPECIFIED', label: 'Не указывать' },
];

// Три наполнения: знакомство до рождения звезды, выбор цветов сразу после него
// и полный профиль по нажатию на свою звезду.
export type ProfileVariant = 'intro' | 'colors' | 'full';

export function ProfileSheet({
	variant = 'full',
	onClose,
}: {
	variant?: ProfileVariant;
	onClose: () => void;
}) {
	const profile = useStore((state) => state.profile);
	const setProfile = useStore((state) => state.setProfile);
	const refreshGraph = useStore((state) => state.refreshGraph);
	const previewColors = useStore((state) => state.previewColors);

	const [name, setName] = useState(profile?.name ?? '');
	const [age, setAge] = useState(profile?.age === null ? '' : String(profile?.age ?? ''));
	const [gender, setGender] = useState<Gender>(profile?.gender ?? 'UNSPECIFIED');
	const [coreColor, setCoreColor] = useState(profile?.coreColor ?? DEFAULT_CORE_COLOR);
	const [flameColor, setFlameColor] = useState(profile?.flameColor ?? DEFAULT_FLAME_COLOR);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [confirmDelete, setConfirmDelete] = useState(false);

	if (!profile) return null;
	const withColors = variant !== 'intro';
	const withFields = variant !== 'colors';

	// Небо красится сразу, до сохранения: цвет выбирают, глядя на свою звезду.
	function pickCore(color: string): void {
		setCoreColor(color);
		previewColors({ core: color, flame: flameColor });
	}

	function pickFlame(color: string): void {
		setFlameColor(color);
		previewColors({ core: coreColor, flame: color });
	}

	async function save(): Promise<void> {
		setBusy(true);
		setError(null);
		try {
			const updated = await meApi.update({
				...(withFields
					? {
							...(profile!.nameLockedByAdmin ? {} : { displayName: name.trim() }),
							age: age.trim() === '' ? null : Number(age),
							gender,
						}
					: {}),
				...(withColors ? { coreColor, flameColor } : {}),
			});
			setProfile(updated);
			previewColors(null);
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

	// Окно цветов не закрывает небо: звезда должна быть видна, пока её красят.
	if (variant === 'colors') {
		return (
			<div className="sheet sheet--bare">
				<div className="sheet__body">
					<h2>Цвет вашей звезды</h2>
					<div className="field">
						<span>Сердцевина</span>
						<Palette value={coreColor} onPick={pickCore} />
					</div>
					<div className="field">
						<span>Пламя</span>
						<Palette value={flameColor} onPick={pickFlame} />
					</div>
					{error && <div className="sheet__error">{error}</div>}
					<div className="sheet__actions">
						<button className="btn" disabled={busy} onClick={() => void save()}>
							Сохранить
						</button>
					</div>
				</div>
			</div>
		);
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

				{withColors && (
					<>
						<div className="field">
							<span>Цвет сердцевины</span>
							<Palette value={coreColor} onPick={pickCore} />
						</div>
						<div className="field">
							<span>Цвет пламени</span>
							<Palette value={flameColor} onPick={pickFlame} />
							<small>Кромка ядра остаётся белой у всех — по ней звезда и читается.</small>
						</div>
					</>
				)}

				{error && <div className="sheet__error">{error}</div>}

				<div className="sheet__actions">
					<button className="btn" disabled={busy} onClick={() => void save()}>
						Сохранить
					</button>
					<button className="btn btn--ghost" disabled={busy} onClick={onClose}>
						Пропустить
					</button>
				</div>

				{withColors && (
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
				)}
			</div>
		</div>
	);
}

function Palette({ value, onPick }: { value: string; onPick: (color: string) => void }) {
	return (
		<div className="palette">
			{STAR_COLORS.map((color) => (
				<button
					key={color}
					className={color === value ? 'palette__dot is-active' : 'palette__dot'}
					style={{ background: color }}
					title={color}
					onClick={() => onPick(color)}
				/>
			))}
		</div>
	);
}
