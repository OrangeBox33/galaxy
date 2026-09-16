import { useEffect, useRef, useState } from 'react';
import { GRAPH_POLL_MS } from '../../../shared/config';
import { useStore } from '../store';
import { EDGES_HIDDEN, createRenderer, type EdgeMode, type Renderer } from '../canvas/renderer';
import { StarCard } from '../components/StarCard';
import { ProfileSheet } from '../components/ProfileSheet';
import { InviteSheet } from '../components/InviteSheet';
import { Suggestions } from '../components/Suggestions';
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
	const [edgeMode, setEdgeMode] = useState<EdgeMode>(
		() => (localStorage.getItem('galaxy:edges') as EdgeMode | null) ?? 'glow',
	);

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
				// Выбор из хранилища, а не из замыкания: иначе сцена пересобиралась бы на каждый выбор.
				const current = useStore.getState().selection;
				if (current?.kind === pick.kind && current.id === pick.id) {
					select(null);
					return;
				}
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

			<Suggestions starAt={(id) => rendererRef.current?.screenOf(id) ?? null} />

			<StarCard
				onEditProfile={() => setShowProfile(true)}
				onFocus={(id) => rendererRef.current?.focusOn(id)}
			/>

			{showProfile && <ProfileSheet onClose={() => setShowProfile(false)} />}
			{showInvite && <InviteSheet onClose={() => setShowInvite(false)} />}
		</div>
	);
}
