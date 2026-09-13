// Экран карты: канвас на весь экран, карточка в углу и панель действий.
import { useEffect, useRef, useState } from 'react';
import { GRAPH_POLL_MS } from '../../../shared/config';
import { useStore } from '../store';
import { createRenderer, type Renderer } from '../canvas/renderer';
import { StarCard } from '../components/StarCard';
import { ProfileSheet } from '../components/ProfileSheet';
import { InviteSheet } from '../components/InviteSheet';
import { haptic } from '../telegram/webapp';

export function Sky({ onOpenAdmin }: { onOpenAdmin: () => void }) {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const rendererRef = useRef<Renderer | null>(null);

	const profile = useStore((state) => state.profile);
	const graph = useStore((state) => state.graph);
	const selection = useStore((state) => state.selection);
	const select = useStore((state) => state.select);
	const hover = useStore((state) => state.hover);
	const refreshGraph = useStore((state) => state.refreshGraph);

	const [showProfile, setShowProfile] = useState(false);
	const [showInvite, setShowInvite] = useState(false);

	// Первый вход: экран профиля поверх карты, но его можно пропустить.
	useEffect(() => {
		if (profile?.needsProfileSetup) setShowProfile(true);
	}, [profile?.needsProfileSetup]);

	useEffect(() => {
		if (!canvasRef.current) return;
		const renderer = createRenderer(canvasRef.current, {
			onPick: (pick) => {
				if (pick.kind === 'empty') {
					select(null);
					return;
				}
				haptic('light');
				select({ kind: pick.kind, id: pick.id });
			},
			onHover: (id) => hover(id),
		});
		rendererRef.current = renderer;
		return () => {
			renderer.destroy();
			rendererRef.current = null;
		};
	}, [select, hover]);

	// Поллинг раз в 30 секунд плюс немедленный перезапрос после своих действий.
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

	// Аватарки прогреваем после первой отрисовки карты, порциями по 8:
	// к первому наведению они уже в кеше браузера.
	useEffect(() => {
		if (!graph) return;
		const files = graph.nodes.map((node) => node.avatar).filter((file): file is string => !!file);
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
					Позвать друга
				</button>
				{profile?.isAdmin && (
					<button className="chip" onClick={onOpenAdmin}>
						Админка
					</button>
				)}
			</div>

			<div className="sky__tools">
				<button className="round" title="Найти меня" onClick={() => rendererRef.current?.focusOnMe()}>
					◎
				</button>
				<button className="round" title="Всё небо" onClick={() => rendererRef.current?.fit()}>
					⤢
				</button>
				<button className="round" title="Приблизить" onClick={() => rendererRef.current?.zoomBy(1.3)}>
					+
				</button>
				<button className="round" title="Отдалить" onClick={() => rendererRef.current?.zoomBy(1 / 1.3)}>
					−
				</button>
			</div>

			<StarCard
				onEditProfile={() => setShowProfile(true)}
				onFocus={(id) => rendererRef.current?.focusOn(id)}
			/>

			{showProfile && <ProfileSheet onClose={() => setShowProfile(false)} />}
			{showInvite && <InviteSheet onClose={() => setShowInvite(false)} />}
		</div>
	);
}
