import { useEffect, useRef, useState } from 'react';
import { GRAPH_POLL_MS } from '../../../shared/config';
import { me as meApi } from '../api/endpoints';
import { playBirth, playClick } from '../sound';
import { useStore } from '../store';
import { EDGES_HIDDEN, createRenderer, type EdgeMode, type Renderer } from '../canvas/renderer';
import { StarCard } from '../components/StarCard';
import { ProfileSheet } from '../components/ProfileSheet';
import { InviteSheet } from '../components/InviteSheet';
import { Suggestions } from '../components/Suggestions';
import { haptic } from '../telegram/webapp';

// Подобрано в песочнице рождения (web/birth.html). Ближе камеры нет: потолок
// зума задан в camera.ts, туда и упираемся.
const BIRTH_FLY_MS = 900;
const BIRTH_PAUSE_MS = 250;
// Окно цветов занимает низ экрана: поднимаем звезду над ним, иначе красить
// будет нечего — она окажется ровно на кромке панели.
const COLORS_SHIFT = 0.22;

export function Sky({ onOpenAdmin }: { onOpenAdmin: () => void }) {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const rendererRef = useRef<Renderer | null>(null);
	const spotRef = useRef<Promise<{ x: number; y: number }> | null>(null);
	const unbornRef = useRef<string | null>(null);

	const profile = useStore((state) => state.profile);
	const graph = useStore((state) => state.graph);
	const selection = useStore((state) => state.selection);
	const select = useStore((state) => state.select);
	const hover = useStore((state) => state.hover);
	const refreshGraph = useStore((state) => state.refreshGraph);
	const refreshProfile = useStore((state) => state.refreshProfile);

	// Первый вход идёт по шагам: знакомство → рождение звезды → цвета.
	const [sheet, setSheet] = useState<'none' | 'intro' | 'colors' | 'profile'>('none');
	// Кого прячем до рождения. Состоянием, а не вызовом рендерера на месте:
	// эффект первого входа отрабатывает раньше, чем канва успевает появиться.
	const [unborn, setUnborn] = useState<string | null>(null);
	const [showInvite, setShowInvite] = useState(false);
	const [edgeMode, setEdgeMode] = useState<EdgeMode>(
		() => (localStorage.getItem('galaxy:edges') as EdgeMode | null) ?? 'glow',
	);

	useEffect(() => {
		if (!profile?.needsBirth) return;
		// Своя звезда не должна показаться раньше собственного рождения.
		setUnborn(profile.id);
		// Место просим сразу: сервер ищет его вместе с пересчётом раскладки, и эта
		// секунда-две проходит, пока человек заполняет профиль.
		spotRef.current = meApi.birth();
		setSheet('intro');
	}, [profile?.needsBirth, profile?.id]);

	// Заведённому заранее (холодный старт) подсказки нашлись бы сразу: до рождения
	// и выбора цвета они висели бы поверх первого входа.
	const firstRun = Boolean(profile?.needsBirth) || sheet === 'intro' || sheet === 'colors';

	async function birth(): Promise<void> {
		const id = profile?.id;
		if (!id) return;
		setSheet('none');

		try {
			const spot = await (spotRef.current ?? meApi.birth());
			await refreshGraph();

			const renderer = rendererRef.current;
			if (renderer) {
				renderer.camera.flyTo(spot.x, spot.y, renderer.camera.maxZoom, BIRTH_FLY_MS);
				await new Promise((done) => setTimeout(done, BIRTH_FLY_MS + BIRTH_PAUSE_MS));
				// Звук сам отмеряет до вспышки по birthTuning, поэтому зовётся вплотную к ignite.
				playBirth(
					useStore.getState().graph?.nodes.find((item) => item.id === id)?.degree ?? 0,
				);
				await renderer.ignite(id);

				const camera = renderer.camera;
				const lift = (camera.viewHeight * COLORS_SHIFT) / camera.zoom;
				camera.flyTo(spot.x, spot.y + lift, camera.zoom, 450);
			}

			await meApi.born();
			await refreshProfile();
		} finally {
			// Не зажглась по ошибке сети — пусть звезда всё равно окажется на небе.
			setUnborn(null);
			setSheet('colors');
		}
	}

	useEffect(() => {
		if (!canvasRef.current) return;
		const renderer = createRenderer(canvasRef.current, {
			onPick: (pick) => {
				if (pick.kind === 'empty') {
					select(null);
					return;
				}
				haptic('light');
				// Выбор из хранилища, а не из замыкания: иначе сцена пересобиралась бы на каждый выбор.
				const current = useStore.getState().selection;
				if (current?.kind === pick.kind && current.id === pick.id) {
					select(null);
					return;
				}
				if (pick.kind === 'node') {
					const node = useStore
						.getState()
						.graph?.nodes.find((item) => item.id === pick.id);
					playClick(node?.degree ?? 0);
				}
				select({ kind: pick.kind, id: pick.id });
			},
			onHover: (id) => hover(id),
		});
		rendererRef.current = renderer;
		// Рендерер пересоздался — спрятанного он о себе не помнит.
		renderer.setHidden(unbornRef.current === null ? [] : [unbornRef.current]);
		return () => {
			renderer.destroy();
			rendererRef.current = null;
		};
	}, [select, hover]);

	useEffect(() => {
		unbornRef.current = unborn;
		rendererRef.current?.setHidden(unborn === null ? [] : [unborn]);
	}, [unborn]);

	useEffect(() => {
		void refreshGraph();
		const timer = setInterval(() => void refreshGraph(), GRAPH_POLL_MS);
		return () => clearInterval(timer);
	}, [refreshGraph]);

	useEffect(() => {
		if (graph) rendererRef.current?.setGraph(graph);
	}, [graph]);

	useEffect(() => {
		rendererRef.current?.setSelection(selection?.kind === 'node' ? selection.id : null);
	}, [selection]);

	useEffect(() => {
		rendererRef.current?.setEdgeMode(edgeMode);
		localStorage.setItem('galaxy:edges', edgeMode);
	}, [edgeMode]);

	useEffect(() => {
		if (!graph) return;
		const files = graph.nodes
			.map((node) => node.avatar)
			.filter((file): file is string => !!file);
		let cancelled = false;
		let index = 0;

		const warm = () => {
			if (cancelled) return;
			for (const file of files.slice(index, index + 8)) {
				const image = new Image();
				image.src = `${import.meta.env.BASE_URL}avatars/${file}`;
			}
			index += 8;
			if (index < files.length) setTimeout(warm, 200);
		};
		const handle = setTimeout(warm, 400);
		return () => {
			cancelled = true;
			clearTimeout(handle);
		};
	}, [graph?.layoutVersion, graph?.nodes.length]);

	return (
		<div className="sky">
			<canvas ref={canvasRef} className="sky__canvas" />

			<div className="sky__top">
				<button className="chip" onClick={() => setShowInvite(true)}>
					Позвать друзей
				</button>
				{!EDGES_HIDDEN && (
					<button
						className="chip"
						title="Как рисовать связи"
						onClick={() => setEdgeMode(edgeMode === 'glow' ? 'full' : 'glow')}
					>
						{edgeMode === 'glow' ? 'Связи: у звёзд' : 'Связи: целиком'}
					</button>
				)}
				{profile?.isAdmin && (
					<button className="chip" onClick={onOpenAdmin}>
						Админка
					</button>
				)}
			</div>

			<div className="sky__tools">
				<button
					className="round"
					title="Найти меня"
					onClick={() => rendererRef.current?.focusOnMe()}
				>
					◎
				</button>
				<button
					className="round"
					title="Всё небо"
					onClick={() => rendererRef.current?.fit()}
				>
					⤢
				</button>
			</div>

			{!firstRun && <Suggestions starAt={(id) => rendererRef.current?.screenOf(id) ?? null} />}

			<StarCard
				onEditProfile={() => setSheet('profile')}
				onFocus={(id) => rendererRef.current?.focusOn(id)}
			/>

			{sheet === 'intro' && <ProfileSheet variant="intro" onClose={() => void birth()} />}
			{sheet === 'colors' && (
				<ProfileSheet variant="colors" onClose={() => setSheet('none')} />
			)}
			{sheet === 'profile' && (
				<ProfileSheet variant="full" onClose={() => setSheet('none')} />
			)}
			{showInvite && <InviteSheet onClose={() => setShowInvite(false)} />}
		</div>
	);
}
