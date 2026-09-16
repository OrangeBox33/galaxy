import { Fragment, useEffect, useMemo, useState } from 'react';
import { GENDERS, type Gender } from '../../../shared/config';
import { admin } from '../api/endpoints';
import { ApiError } from '../api/client';
import { useStore } from '../store';
import { Avatar } from '../components/Avatar';
import type { AdminLink, AdminUser } from '../api/types';

type SortKey = 'name' | 'links' | 'createdAt' | 'lastSeenAt' | 'id';

const GENDER_LABEL: Record<Gender, string> = {
	MALE: 'М',
	FEMALE: 'Ж',
	UNSPECIFIED: '—',
};

export function Admin({ onLeave }: { onLeave: () => void }) {
	const profile = useStore((state) => state.profile);
	const refreshGraph = useStore((state) => state.refreshGraph);

	const [users, setUsers] = useState<AdminUser[]>([]);
	const [query, setQuery] = useState('');
	const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'links', desc: true });
	const [error, setError] = useState<string | null>(null);
	const [status, setStatus] = useState<string | null>(null);
	const [openLinks, setOpenLinks] = useState<Record<string, AdminLink[] | 'loading'>>({});
	const [linkTarget, setLinkTarget] = useState<{ id: string; query: string } | null>(null);
	const [deleting, setDeleting] = useState<{ id: string; typed: string } | null>(null);
	const [busy, setBusy] = useState(false);

	async function reload(): Promise<void> {
		try {
			setUsers(await admin.users());
			setError(null);
		} catch (err) {
			setError(err instanceof ApiError ? err.message : 'Не удалось загрузить список');
		}
	}

	useEffect(() => {
		void reload();
	}, []);

	const shown = useMemo(() => {
		const needle = query.trim().toLowerCase();
		const filtered = needle
			? users.filter(
					(user) =>
						user.name.toLowerCase().includes(needle) ||
						(user.username ?? '').toLowerCase().includes(needle) ||
						user.id.includes(needle),
				)
			: users;

		const sorted = [...filtered].sort((a, b) => {
			const factor = sort.desc ? -1 : 1;
			if (sort.key === 'links') return (a.links - b.links) * factor;
			if (sort.key === 'id') return (Number(a.id) - Number(b.id)) * factor;
			if (sort.key === 'name') return a.name.localeCompare(b.name, 'ru') * factor;
			return (Date.parse(a[sort.key]) - Date.parse(b[sort.key])) * factor;
		});
		return sorted;
	}, [users, query, sort]);

	const totals = useMemo(
		() => ({
			users: users.length,
			links: users.reduce((sum, user) => sum + user.links, 0) / 2,
			pending: users.reduce((sum, user) => sum + (user.invitesSent - user.invitesAccepted), 0),
		}),
		[users],
	);

	function toggleSort(key: SortKey): void {
		setSort((current) => ({ key, desc: current.key === key ? !current.desc : true }));
	}

	async function patch(
		id: string,
		change: { displayName?: string; age?: number | null; gender?: Gender; isBlocked?: boolean },
		optimistic: Partial<AdminUser>,
	): Promise<void> {
		const before = users;
		setUsers((current) =>
			current.map((user) => (user.id === id ? { ...user, ...optimistic } : user)),
		);
		try {
			await admin.update(id, change);
			await reload();
			await refreshGraph();
		} catch (err) {
			setUsers(before);
			setError(err instanceof ApiError ? err.message : 'Изменение не сохранилось');
		}
	}

	async function showLinks(id: string): Promise<void> {
		if (openLinks[id]) {
			setOpenLinks((current) => {
				const next = { ...current };
				delete next[id];
				return next;
			});
			return;
		}
		setOpenLinks((current) => ({ ...current, [id]: 'loading' }));
		const rows = await admin.userLinks(id);
		setOpenLinks((current) => ({ ...current, [id]: rows }));
	}

	async function recompute(mode: 'full' | 'warm'): Promise<void> {
		setBusy(true);
		setStatus(mode === 'full' ? 'Перекладываю небо заново…' : 'Досчитываю раскладку…');
		try {
			const result = await admin.recompute(mode);
			setStatus(`Готово: версия ${result.version}, ${result.nodes} звёзд, ${result.ms} мс`);
			await refreshGraph();
		} catch (err) {
			setStatus(null);
			setError(err instanceof ApiError ? err.message : 'Пересчёт не удался');
		} finally {
			setBusy(false);
		}
	}

	async function createTest(): Promise<void> {
		const name = window.prompt('Имя тестового пользователя');
		if (!name) return;
		try {
			await admin.createTest({ name });
			await reload();
			await refreshGraph();
		} catch (err) {
			setError(err instanceof ApiError ? err.message : 'Не удалось создать');
		}
	}

	if (!profile?.isAdmin) {
		return (
			<div className="boot">
				<h1>Galaxy</h1>
				<p>Этот раздел только для владельца.</p>
			</div>
		);
	}

	return (
		<div className="admin">
			<header className="admin__head">
				<button className="chip" onClick={onLeave}>
					← К карте
				</button>
				<div className="admin__counters">
					<span>пользователей: {totals.users}</span>
					<span>связей: {totals.links}</span>
					<span>приглашений ждут: {totals.pending}</span>
				</div>
				<div className="admin__tools">
					<input
						className="admin__search"
						placeholder="поиск по имени, username или id"
						value={query}
						onChange={(event) => setQuery(event.target.value)}
					/>
					<button className="btn" onClick={() => void createTest()}>
						Создать тестового
					</button>
					<button className="btn btn--ghost" disabled={busy} onClick={() => void recompute('warm')}>
						Досчитать раскладку
					</button>
					<button className="btn btn--ghost" disabled={busy} onClick={() => void recompute('full')}>
						Переложить заново
					</button>
				</div>
			</header>

			{status && <div className="admin__status">{status}</div>}
			{error && <div className="admin__error" onClick={() => setError(null)}>{error}</div>}

			<table className="admin__table">
				<thead>
					<tr>
						<th />
						<th onClick={() => toggleSort('id')}>ID</th>
						<th onClick={() => toggleSort('name')}>Имя</th>
						<th>Username</th>
						<th>Возраст</th>
						<th>Пол</th>
						<th onClick={() => toggleSort('links')}>Связей</th>
						<th>Приглашений</th>
						<th>Тестовый</th>
						<th>Активен</th>
						<th>Действия</th>
					</tr>
				</thead>
				<tbody>
					{shown.map((user) => (
						<Fragment key={user.id}>
							<tr>
								<td>
									<Avatar name={user.name} file={user.avatar} gender={user.gender} size={28} />
								</td>
								<td
									className="mono"
									title="Скопировать"
									onClick={() => void navigator.clipboard.writeText(user.id)}
								>
									{user.id}
								</td>
								<td>
									<input
										className="cell"
										defaultValue={user.name}
										onKeyDown={(event) => {
											if (event.key === 'Enter') event.currentTarget.blur();
										}}
										onBlur={(event) => {
											const value = event.target.value.trim();
											if (value && value !== user.name) {
												void patch(user.id, { displayName: value }, { name: value });
											}
										}}
									/>
								</td>
								<td>{user.username ? `@${user.username}` : '—'}</td>
								<td>
									<input
										className="cell cell--narrow"
										defaultValue={user.age ?? ''}
										onKeyDown={(event) => {
											if (event.key === 'Enter') event.currentTarget.blur();
										}}
										onBlur={(event) => {
											const raw = event.target.value.trim();
											const value = raw === '' ? null : Number(raw);
											if (value !== user.age) {
												void patch(user.id, { age: value }, { age: value });
											}
										}}
									/>
								</td>
								<td>
									<select
										className="cell cell--narrow"
										value={user.gender}
										onChange={(event) => {
											const value = event.target.value as Gender;
											void patch(user.id, { gender: value }, { gender: value });
										}}
									>
										{GENDERS.map((value) => (
											<option key={value} value={value}>
												{GENDER_LABEL[value]}
											</option>
										))}
									</select>
								</td>
								<td className="clickable" onClick={() => void showLinks(user.id)}>
									{user.links}
								</td>
								<td>
									{user.invitesSent} / {user.invitesAccepted}
								</td>
								<td>{user.isTest ? <span className="badge">тест</span> : ''}</td>
								<td>
									<input
										type="checkbox"
										checked={!user.isBlocked}
										onChange={(event) => {
											const blocked = !event.target.checked;
											void patch(user.id, { isBlocked: blocked }, { isBlocked: blocked });
										}}
									/>
								</td>
								<td className="admin__actions">
									<button
										className="btn btn--quiet"
										onClick={() =>
											setLinkTarget(linkTarget?.id === user.id ? null : { id: user.id, query: '' })
										}
									>
										Связать с…
									</button>
									<button
										className="btn btn--quiet"
										onClick={() => setDeleting({ id: user.id, typed: '' })}
									>
										Удалить
									</button>
								</td>
							</tr>

							{openLinks[user.id] && (
								<tr className="admin__sub">
									<td colSpan={11}>
										{openLinks[user.id] === 'loading' ? (
											'загружаю…'
										) : (
											<div className="chips">
												{(openLinks[user.id] as AdminLink[]).map((link) => (
													<span className="chip chip--link" key={link.id}>
														{link.otherName}
														<button
															onClick={async () => {
																await admin.removeLink(user.id, link.otherId);
																await reload();
																await refreshGraph();
																setOpenLinks((current) => {
																	const next = { ...current };
																	delete next[user.id];
																	return next;
																});
															}}
														>
															×
														</button>
													</span>
												))}
												{(openLinks[user.id] as AdminLink[]).length === 0 && 'связей нет'}
											</div>
										)}
									</td>
								</tr>
							)}

							{linkTarget?.id === user.id && (
								<tr className="admin__sub">
									<td colSpan={11}>
										<input
											className="cell"
											autoFocus
											placeholder="кого связать: имя или id"
											value={linkTarget.query}
											onChange={(event) =>
												setLinkTarget({ id: user.id, query: event.target.value })
											}
										/>
										<div className="chips">
											{users
												.filter(
													(candidate) =>
														candidate.id !== user.id &&
														linkTarget.query.trim() !== '' &&
														(candidate.name
															.toLowerCase()
															.includes(linkTarget.query.toLowerCase()) ||
															candidate.id.includes(linkTarget.query)),
												)
												.slice(0, 8)
												.map((candidate) => (
													<button
														className="chip"
														key={candidate.id}
														onClick={async () => {
															try {
																await admin.createLink(user.id, candidate.id);
																setLinkTarget(null);
																await reload();
																await refreshGraph();
															} catch (err) {
																setError(
																	err instanceof ApiError
																		? err.message
																		: 'Не удалось связать',
																);
															}
														}}
													>
														{candidate.name}
													</button>
												))}
										</div>
									</td>
								</tr>
							)}

							{deleting?.id === user.id && (
								<tr className="admin__sub">
									<td colSpan={11}>
										<span>
											Удалить «{user.name}» со всеми связями? Введите имя для подтверждения:
										</span>
										<input
											className="cell"
											autoFocus
											value={deleting.typed}
											onChange={(event) =>
												setDeleting({ id: user.id, typed: event.target.value })
											}
										/>
										<button
											className="btn btn--danger"
											disabled={deleting.typed.trim() !== user.name}
											onClick={async () => {
												await admin.remove(user.id);
												setDeleting(null);
												await reload();
												await refreshGraph();
											}}
										>
											Удалить
										</button>
										<button className="btn btn--ghost" onClick={() => setDeleting(null)}>
											Отмена
										</button>
									</td>
								</tr>
							)}
						</Fragment>
					))}
				</tbody>
			</table>
		</div>
	);
}
