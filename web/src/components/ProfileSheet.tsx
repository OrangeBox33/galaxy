import { useRef, useState } from 'react';
import {
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
	{ value: 'UNSPECIFIED', label: '—' },
];

const SWIPE_CLOSE_PX = 90;

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

	const bodyRef = useRef<HTMLDivElement>(null);
	const drag = useRef<{ pointer: number; from: number } | null>(null);

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

	function gripDown(event: React.PointerEvent<HTMLDivElement>): void {
		drag.current = { pointer: event.pointerId, from: event.clientY };
		event.currentTarget.setPointerCapture(event.pointerId);
	}

	function gripMove(event: React.PointerEvent<HTMLDivElement>): void {
		if (drag.current?.pointer !== event.pointerId) return;
		const shift = Math.max(0, event.clientY - drag.current.from);
		const body = bodyRef.current;
		if (!body) return;
		body.style.transition = 'none';
		body.style.transform = `translateY(${shift}px)`;
	}

	function gripUp(event: React.PointerEvent<HTMLDivElement>): void {
		if (drag.current?.pointer !== event.pointerId) return;
		const shift = Math.max(0, event.clientY - drag.current.from);
		drag.current = null;
		const body = bodyRef.current;
		if (body) {
			body.style.transition = '';
			body.style.transform = '';
		}
		if (shift > SWIPE_CLOSE_PX) onClose();
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
			<div className="sheet sheet--bare sheet--colors">
				<div className="sheet__body">
					<h2>Цвет вашей звезды</h2>
					<div className="field">
						<span>Ядро</span>
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

	const nameInput = (
		<input
			value={name}
			maxLength={32}
			disabled={profile.nameLockedByAdmin}
			onChange={(event) => setName(event.target.value)}
		/>
	);

	const ageInput = (
		<input
			value={age}
			inputMode="numeric"
			placeholder="—"
			onChange={(event) => setAge(event.target.value.replace(/\D/g, '').slice(0, 3))}
		/>
	);

	const lockedNote = profile.nameLockedByAdmin ? (
		<small>Имя изменено администратором, поменять его нельзя.</small>
	) : null;

	const genderPicker = (
		<div className="segmented segmented--tight">
			{GENDER_LABELS.map((option) => (
				<button
					key={option.value}
					className={
						gender === option.value ? 'segmented__item is-active' : 'segmented__item'
					}
					title={option.value === 'UNSPECIFIED' ? 'Не указывать' : option.label}
					onClick={() => setGender(option.value)}
				>
					{option.label}
				</button>
			))}
		</div>
	);

	const swipeable = variant === 'full';

	return (
		<div className={swipeable ? 'sheet sheet--bare sheet--profile' : 'sheet'}>
			<div className="sheet__body" ref={bodyRef}>
				{swipeable && (
					<>
						<div
							className="sheet__grip"
							onPointerDown={gripDown}
							onPointerMove={gripMove}
							onPointerUp={gripUp}
							onPointerCancel={gripUp}
						/>
						<button className="sheet__close" onClick={onClose}>
							×
						</button>
					</>
				)}

				<div className="sheet__head">
					<Avatar name={profile.name} file={profile.avatar} gender={gender} size={64} />
					<h2>Ваша звезда</h2>
				</div>

				<label className="field">
					<span>Имя</span>
					{nameInput}
				</label>
				{lockedNote}
				<div className="row">
					<label className="field row__age">
						<span>Возраст</span>
						{ageInput}
					</label>
					<div className="field row__wide">
						<span>Пол</span>
						{genderPicker}
					</div>
				</div>

				{withColors && (
					<>
						<div className="field">
							<span>Цвет ядра</span>
							<Palette value={coreColor} onPick={pickCore} />
						</div>
						<div className="field">
							<span>Цвет пламени</span>
							<Palette value={flameColor} onPick={pickFlame} />
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
								<button
									className="btn btn--danger"
									disabled={busy}
									onClick={() => void remove()}
								>
									Да, удалить
								</button>
								<button
									className="btn btn--ghost"
									onClick={() => setConfirmDelete(false)}
								>
									Отмена
								</button>
							</>
						) : (
							<button
								className="btn btn--quiet"
								onClick={() => setConfirmDelete(true)}
							>
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
