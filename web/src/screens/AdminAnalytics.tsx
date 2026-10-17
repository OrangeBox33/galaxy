import { useEffect, useMemo, useState } from 'react';
import { admin } from '../api/endpoints';
import { ApiError } from '../api/client';
import type { AdminAnalytics as Data } from '../api/types';

const LABELS: Record<string, string> = {
	visit: 'Вход',
	session: 'Время в приложении',
	invite_arrival: 'Пришли по ссылке',
	star_tap: 'Нажатие на звезду',
	card_focus: 'Имя в карточке',
	link: '«Связать»',
	unlink: '«Развязать»',
	suggest_shown: 'Показ подсказки',
	suggest_dismiss: '«Нет» в подсказке',
	color_change: 'Смена цвета',
	profile_open: 'Открыл профиль',
	profile_save: 'Сохранил профиль',
	account_delete: 'Удалил аккаунт',
	invite_open: '«Позвать друзей»',
	invite_share: '«Отправить друзьям»',
	invite_copy: '«Скопировать ссылку»',
	tool: 'Кнопки справа внизу',
	gesture: 'Жест за загрузку',
	first_intro: 'Первый вход: знакомство',
	first_born: 'Первый вход: рождение',
	first_colors: 'Первый вход: цвета',
};

const DETAILS: Record<string, string> = {
	link: 'по ссылке',
	notify: 'из уведомления',
	welcome: 'из приветствия',
	direct: 'напрямую',
	self: 'своя',
	other: 'чужая',
	card: 'из карточки',
	suggest: 'из подсказки',
	first: 'при рождении',
	profile: 'в профиле',
	find_me: 'найти меня',
	fit: 'всё небо',
	constellation_on: 'показать связи',
	constellation_off: 'скрыть связи',
	zoom: 'зум',
	pan: 'сдвиг неба',
	grab: 'тянул звезду',
};

const FUNNEL = ['first_intro', 'first_born', 'first_colors'] as const;

const COLUMNS: { key: string; title: string }[] = [
	{ key: 'visit', title: 'Входов' },
	{ key: 'star_tap', title: 'Звёзды' },
	{ key: 'link', title: 'Связать' },
	{ key: 'unlink', title: 'Развязать' },
	{ key: 'color_change', title: 'Цвет' },
	{ key: 'invite_open', title: 'Позвать' },
	{ key: 'invite_share', title: 'Отправить' },
	{ key: 'invite_arrival', title: 'Пришло' },
	{ key: 'tool', title: 'Кнопки' },
];

function duration(seconds: number): string {
	if (seconds < 60) return `${seconds} с`;
	const minutes = Math.round(seconds / 60);
	if (minutes < 60) return `${minutes} мин`;
	return `${Math.floor(minutes / 60)} ч ${minutes % 60} мин`;
}

function when(iso: string | null): string {
	return iso ? new Date(iso).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' }) : '—';
}

export function AdminAnalytics() {
	const [data, setData] = useState<Data | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [sort, setSort] = useState<{ key: string; desc: boolean }>({ key: 'visit', desc: true });

	useEffect(() => {
		admin
			.analytics()
			.then(setData)
			.catch((err: unknown) =>
				setError(err instanceof ApiError ? err.message : 'Не удалось загрузить аналитику'),
			);
	}, []);

	const users = useMemo(() => {
		if (!data) return [];
		const value = (row: Data['users'][number]): number | string =>
			sort.key === 'name'
				? (row.name ?? '')
				: sort.key === 'sessionSec'
					? row.sessionSec
					: sort.key === 'lastAt'
						? Date.parse(row.lastAt ?? '') || 0
						: (row.counts[sort.key] ?? 0);
		return [...data.users].sort((a, b) => {
			const x = value(a);
			const y = value(b);
			const order =
				typeof x === 'string' ? x.localeCompare(y as string, 'ru') : x - (y as number);
			return sort.desc ? -order : order;
		});
	}, [data, sort]);

	function toggleSort(key: string): void {
		setSort((current) => ({ key, desc: current.key === key ? !current.desc : true }));
	}

	if (error) return <div className="admin__error">{error}</div>;
	if (!data) return <div className="admin__status">Загружаю…</div>;

	const people = (type: string) =>
		data.totals.filter((row) => row.type === type).reduce((sum, row) => sum + row.users, 0);

	return (
		<div className="analytics">
			<section>
				<h3>Воронка первого входа</h3>
				<div className="admin__counters">
					{FUNNEL.map((type) => (
						<span key={type}>
							{LABELS[type]}: {people(type)}
						</span>
					))}
				</div>
			</section>

			<section>
				<h3>По дням, Москва</h3>
				<table className="admin__table admin__table--compact">
					<thead>
						<tr>
							<th>День</th>
							<th>Людей</th>
							<th>Входов</th>
						</tr>
					</thead>
					<tbody>
						{data.daily.map((row) => (
							<tr key={row.date}>
								<td>{row.date}</td>
								<td>{row.users}</td>
								<td>{row.visits}</td>
							</tr>
						))}
					</tbody>
				</table>
			</section>

			<section>
				<h3>События</h3>
				<table className="admin__table">
					<thead>
						<tr>
							<th>Событие</th>
							<th>Уточнение</th>
							<th>24 ч</th>
							<th>7 дней</th>
							<th>Всего</th>
							<th>Людей</th>
						</tr>
					</thead>
					<tbody>
						{data.totals.map((row) => (
							<tr key={`${row.type}:${row.detail ?? ''}`}>
								<td>{LABELS[row.type] ?? row.type}</td>
								<td>
									{row.type === 'session'
										? `всего ${duration(row.seconds)}, в среднем ${duration(Math.round(row.seconds / Math.max(1, row.all)))}`
										: row.detail
											? (DETAILS[row.detail] ?? row.detail)
											: ''}
								</td>
								<td>{row.day}</td>
								<td>{row.week}</td>
								<td>{row.all}</td>
								<td>{row.users}</td>
							</tr>
						))}
					</tbody>
				</table>
			</section>

			<section>
				<h3>По людям</h3>
				<table className="admin__table">
					<thead>
						<tr>
							<th onClick={() => toggleSort('name')}>Имя</th>
							<th>Платформа</th>
							{COLUMNS.map((column) => (
								<th key={column.key} onClick={() => toggleSort(column.key)}>
									{column.title}
								</th>
							))}
							<th onClick={() => toggleSort('sessionSec')}>В приложении</th>
							<th onClick={() => toggleSort('lastAt')}>Последнее</th>
						</tr>
					</thead>
					<tbody>
						{users.map((row) => (
							<tr key={row.id}>
								<td>
									{row.name ?? <span className="badge">удалён</span>}
									{row.username && <span className="analytics__dim"> @{row.username}</span>}
								</td>
								<td>{row.platform ?? '—'}</td>
								{COLUMNS.map((column) => (
									<td key={column.key}>{row.counts[column.key] ?? 0}</td>
								))}
								<td>{duration(row.sessionSec)}</td>
								<td>{when(row.lastAt)}</td>
							</tr>
						))}
					</tbody>
				</table>
			</section>
		</div>
	);
}
