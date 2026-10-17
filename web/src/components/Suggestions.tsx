// Окно «возможные друзья»: до трёх карточек, каждая — человек в двух шагах по графу.
//
// Слот отвечает только за место в стопке, содержимое — только за появление и уход:
// иначе въезд снизу и подъём в стопке дрались бы за один transform. Уходящая карточка
// держит своё место до конца анимации — иначе взрыв подсветит подъехавшую снизу соседку.
// Карточка живёт своей копией данных: по текущему списку кандидатов она исчезала бы
// под пальцем, когда своя же новая связь роняет у соседей число общих друзей.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Gender } from '../../../shared/config';
import { playLink } from '../sound';
import { useStore } from '../store';
import { suggestFriends, suggestHubs } from '../../../shared/suggest';
import { Avatar } from './Avatar';
import { haptic } from '../telegram/webapp';
import { track, trackOnce } from '../analytics';

export type StarAt = (id: string) => { x: number; y: number; radius: number } | null;

const VISIBLE = 3;
// Шаг стопки — высота карточки плюс зазор; то же число в styles.css.
const STEP = 72;
const BURST_MS = 360;
// Доля BURST_MS, к которой карточка сжалась в точку: тогда и стартует искра.
const SEED_AT = 0.62;
const FLIGHT_MS = 320;
// Отступ от кромки экрана: на ней гаснет искра, если звезда за краем.
const EDGE_MARGIN = 26;
// Угасание по «Нет»; оба числа есть и в styles.css.
const FADE_MS = 340;

type Exit = { mode: 'burst' | 'fade'; fx: string; fy: string };

type Row = {
	id: string;
	name: string;
	avatar: string | null;
	gender: Gender;
	// Добивка из самых связных: всегда ниже друзей друзей.
	hub?: boolean;
	// Пока заполнено — карточка догорает, но место в стопке ещё держит.
	exit?: Exit;
};

function same(a: Row[], b: Row[]): boolean {
	return (
		a.length === b.length &&
		a.every((row, i) => row.id === b[i].id && row.exit === b[i].exit && row.hub === b[i].hub)
	);
}

// Искра живёт в body с position: fixed: у карточки overflow: hidden, у неба своя канва,
// и перелететь из одного в другое внутри React-дерева нечем.
function flySpark(from: { x: number; y: number }, to: { x: number; y: number } | null): void {
	if (!to || typeof document === 'undefined') return;
	if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;

	let endX = to.x;
	let endY = to.y;
	const inside =
		to.x >= EDGE_MARGIN &&
		to.y >= EDGE_MARGIN &&
		to.x <= window.innerWidth - EDGE_MARGIN &&
		to.y <= window.innerHeight - EDGE_MARGIN;
	if (!inside) {
		const dx = to.x - from.x;
		const dy = to.y - from.y;
		let k = 1;
		if (dx !== 0) {
			k = Math.min(
				k,
				Math.max(
					(EDGE_MARGIN - from.x) / dx,
					(window.innerWidth - EDGE_MARGIN - from.x) / dx,
				),
			);
		}
		if (dy !== 0) {
			k = Math.min(
				k,
				Math.max(
					(EDGE_MARGIN - from.y) / dy,
					(window.innerHeight - EDGE_MARGIN - from.y) / dy,
				),
			);
		}
		k = Math.max(0.15, Math.min(1, k));
		endX = from.x + dx * k;
		endY = from.y + dy * k;
	}

	const seed = document.createElement('div');
	seed.className = 'suggest__seed';
	seed.style.left = `${from.x}px`;
	seed.style.top = `${from.y}px`;
	document.body.appendChild(seed);

	const dx = endX - from.x;
	const dy = endY - from.y;
	const animation = seed.animate(
		[
			{ transform: 'translate(0px, 0px) scale(0.35)', opacity: 0.9 },
			{
				transform: `translate(${dx * 0.45}px, ${dy * 0.45}px) scale(1)`,
				opacity: 1,
				offset: 0.3,
			},
			{ transform: `translate(${dx}px, ${dy}px) scale(${inside ? 0.22 : 0.5})`, opacity: 0 },
		],
		{ duration: FLIGHT_MS, easing: 'cubic-bezier(0.35, 0, 0.25, 1)', fill: 'forwards' },
	);
	const remove = () => seed.remove();
	animation.addEventListener('finish', remove);
	animation.addEventListener('cancel', remove);
	// Подстраховка: если вкладку свернули, события анимации могут не прийти.
	setTimeout(remove, FLIGHT_MS + 400);
}

export function Suggestions({ starAt }: { starAt: StarAt }) {
	const graph = useStore((state) => state.graph);
	const dismissedLocal = useStore((state) => state.dismissedLocal);
	const linkWith = useStore((state) => state.linkWith);
	const dismissSuggestion = useStore((state) => state.dismissSuggestion);

	const [rows, setRows] = useState<Row[]>([]);
	const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
	const leaving = useRef(new Set<string>());

	useEffect(
		() => () => {
			timers.current.forEach(clearTimeout);
		},
		[],
	);

	const dismissed = new Set<string>([...(graph?.dismissed ?? []), ...dismissedLocal]);
	const ranked = graph ? suggestFriends(graph, dismissed) : [];
	const hubs = useMemo(
		() =>
			graph ? suggestHubs(graph, new Set([...(graph.dismissed ?? []), ...dismissedLocal])) : [],
		[graph, dismissedLocal],
	);
	const nodes = new Map((graph?.nodes ?? []).map((node) => [node.id, node]));

	const friends = new Set<string>();
	for (const [a, b] of graph?.edges ?? []) {
		if (a === graph?.me) friends.add(b);
		if (b === graph?.me) friends.add(a);
	}

	// Падение числа общих друзей — не повод убрать карточку; догорающую не трогаем вовсе.
	function keep(row: Row): boolean {
		if (row.exit) return true;
		const node = nodes.get(row.id);
		return !!node && !node.isBlocked && !friends.has(row.id) && !dismissed.has(row.id);
	}

	function fresh(row: Row): Row {
		const node = row.exit ? undefined : nodes.get(row.id);
		return node ? { ...row, name: node.name, avatar: node.avatar, gender: node.gender } : row;
	}

	// Догорающие карточки место занимают и не сдвигаются: новая прилетит
	// не раньше, чем старая исчезнет. Друг друга, нашедшийся позже, встаёт выше
	// хабов, а лишний хаб угасает.
	function fill(current: Row[]): Row[] {
		const mains = new Set(ranked.map(({ node }) => node.id));
		const shown = new Set(current.map((row) => row.id));
		const live = current
			.filter((row) => !row.exit && keep(row))
			.map((row) => (row.hub && mains.has(row.id) ? { ...row, hub: false } : row));
		const row = (node: (typeof hubs)[number], hub: boolean): Row => ({
			id: node.id,
			name: node.name,
			avatar: node.avatar,
			gender: node.gender,
			hub,
		});

		const order = [
			...live.filter((item) => !item.hub),
			...ranked.filter(({ node }) => !shown.has(node.id)).map(({ node }) => row(node, false)),
			...live.filter((item) => item.hub),
			...hubs
				.filter((node) => !shown.has(node.id) && !mains.has(node.id))
				.map((node) => row(node, true)),
		];

		const exiting = current.filter((item) => item.exit).length;
		const next = order.slice(0, Math.max(0, VISIBLE - exiting));
		current.forEach((item, i) => {
			if (item.exit) next.splice(i, 0, item);
		});
		for (const item of order.slice(next.length - exiting)) {
			if (shown.has(item.id)) next.push({ ...item, exit: { mode: 'fade', fx: '50%', fy: '50%' } });
		}
		return next;
	}

	useEffect(() => {
		setRows((current) => {
			const next = fill(current).map(fresh);
			return same(next, current) ? current : next;
		});
		// Без зависимостей: setRows вернёт прежний массив, если ничего не изменилось.
	});

	useEffect(() => {
		for (const row of rows) if (!row.exit) trackOnce(`suggest:${row.id}`, 'suggest_shown');
	}, [rows]);

	useEffect(() => {
		for (const row of rows) {
			if (!row.exit || leaving.current.has(row.id)) continue;
			leaving.current.add(row.id);
			timers.current.push(
				setTimeout(
					() => {
						leaving.current.delete(row.id);
						setRows((current) => current.filter((item) => item.id !== row.id));
					},
					row.exit.mode === 'burst' ? BURST_MS : FADE_MS,
				),
			);
		}
	}, [rows]);

	function leave(row: Row, mode: Exit['mode'], event: React.MouseEvent<HTMLButtonElement>) {
		if (row.exit) return;

		const card = event.currentTarget.closest('.suggest__item') as HTMLElement | null;
		const button = event.currentTarget.getBoundingClientRect();
		const box = card?.getBoundingClientRect();
		// Центр нажатой кнопки: он же transform-origin карточки и старт искры.
		const at = { x: button.left + button.width / 2, y: button.top + button.height / 2 };
		const exit: Exit = {
			mode,
			fx: box ? `${at.x - box.left}px` : '50%',
			fy: box ? `${at.y - box.top}px` : '50%',
		};

		if (mode === 'burst') {
			playLink(nodes.get(graph!.me)?.degree ?? 0, nodes.get(row.id)?.degree ?? 0);
			setTimeout(() => flySpark(at, starAt(graph!.me)), BURST_MS * SEED_AT);
		}

		setRows((current) =>
			current.map((item) => (item.id === row.id ? { ...item, exit } : item)),
		);
	}

	if (!graph || rows.length === 0) return null;

	return (
		<div className="suggest" aria-label="Возможные друзья">
			{rows.map((row, slot) => (
				<div
					key={row.id}
					className={`suggest__slot${row.exit ? ' suggest__slot--leaving' : ''}`}
					style={{ transform: `translateY(${slot * STEP}px)` }}
				>
					<div
						className={`suggest__item${row.exit ? ` suggest__item--${row.exit.mode}` : ''}`}
						style={
							row.exit
								? {
										['--fx' as string]: row.exit.fx,
										['--fy' as string]: row.exit.fy,
									}
								: undefined
						}
					>
						<Avatar name={row.name} file={row.avatar} gender={row.gender} size={30} />
						<div className="suggest__body">
							<div className="suggest__name">{row.name}</div>
							<div className="suggest__actions">
								<button
									className="suggest__btn"
									onClick={(event) => {
										haptic('light');
										track('link', 'suggest');
										leave(row, 'burst', event);
										// Ошибку глотаем: хранилище вернёт граф назад, и карточка придёт снова.
										void linkWith(row.id).catch(() => {});
									}}
								>
									Связать
								</button>
								<button
									className="suggest__btn suggest__btn--ghost"
									onClick={(event) => {
										track('suggest_dismiss');
										leave(row, 'fade', event);
										void dismissSuggestion(row.id);
									}}
								>
									Нет
								</button>
							</div>
						</div>
					</div>
				</div>
			))}
		</div>
	);
}
