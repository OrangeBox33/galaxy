// Истина — серверная раскладка, но её координаты младше версии предсказания описывают
// карту до нашего действия, и мы их не применяем.
import { create } from 'zustand';
import {
	graph as graphApi,
	links as linksApi,
	me as meApi,
	suggestions as suggestionsApi,
} from './api/endpoints';
import { predictLayout, type Prediction } from './layout/predict';
import type { Graph, Profile } from './api/types';

type Selection = { kind: 'node'; id: string } | { kind: 'invite'; id: string } | null;

const FOLLOW_UP_MS = [6000, 12000, 20000];

type State = {
	profile: Profile | null;
	graph: Graph | null;
	selection: Selection;
	hovered: string | null;
	error: string | null;

	prediction: { version: number; nodes: Prediction } | null;

	// Отказы этого сеанса: сервер вернёт их лишь следующим опросом, а карточка уходит сразу.
	dismissedLocal: string[];

	setProfile: (profile: Profile | null) => void;
	refreshProfile: () => Promise<void>;
	refreshGraph: () => Promise<void>;
	linkWith: (targetId: string) => Promise<void>;
	dismissSuggestion: (targetId: string) => Promise<void>;
	unlinkFrom: (targetId: string) => Promise<void>;
	select: (selection: Selection) => void;
	hover: (id: string | null) => void;
};

function applyPrediction(graph: Graph, prediction: Prediction): Graph {
	return {
		...graph,
		nodes: graph.nodes.map((node) => {
			const predicted = prediction.get(node.id);
			return predicted
				? {
						...node,
						x: predicted.x,
						y: predicted.y,
						degree: predicted.degree,
						centrality: predicted.centrality,
					}
				: node;
		}),
	};
}

export const useStore = create<State>((set, get) => {
	let followUps: ReturnType<typeof setTimeout>[] = [];

	function scheduleFollowUps(): void {
		followUps.forEach(clearTimeout);
		followUps = FOLLOW_UP_MS.map((delay) =>
			setTimeout(() => void get().refreshGraph(), delay),
		);
	}

	async function optimistic(
		change: (graph: Graph) => Graph,
		request: () => Promise<unknown>,
	): Promise<void> {
		const before = get().graph;
		if (!before) {
			await request();
			await get().refreshGraph();
			return;
		}

		const changed = change(before);
		set({ graph: changed, prediction: { version: before.layoutVersion, nodes: new Map() } });

		const [predicted] = await Promise.all([
			predictLayout(changed, changed.edges),
			request().catch((err: Error) => {
				set({ graph: before, prediction: null, error: err.message });
				throw err;
			}),
		]);

		if (predicted && get().prediction) {
			set({
				graph: applyPrediction(get().graph ?? changed, predicted),
				prediction: { version: before.layoutVersion, nodes: predicted },
			});
		}

		scheduleFollowUps();
		await get().refreshGraph();
	}

	return {
		profile: null,
		graph: null,
		selection: null,
		hovered: null,
		error: null,
		prediction: null,
		dismissedLocal: [],

		setProfile: (profile) => set({ profile }),

		refreshProfile: async () => {
			set({ profile: await meApi.get() });
		},

		refreshGraph: async () => {
			try {
				const fresh = await graphApi.get();
				const prediction = get().prediction;

				if (prediction && fresh.layoutVersion <= prediction.version) {
					set({
						graph: prediction.nodes.size > 0 ? applyPrediction(fresh, prediction.nodes) : fresh,
						error: null,
					});
					return;
				}

				set({ graph: fresh, prediction: null, error: null });
			} catch (err) {
				set({ error: (err as Error).message });
			}
		},

		linkWith: async (targetId) => {
			const me = get().graph?.me;
			if (!me) return;
			await optimistic(
				(graph) => ({
					...graph,
					edges: [...graph.edges, [me, targetId] as [string, string]],
				}),
				() => linksApi.create(targetId),
			);
		},

		dismissSuggestion: async (targetId) => {
			const before = get().dismissedLocal;
			if (before.includes(targetId)) return;
			set({ dismissedLocal: [...before, targetId] });
			try {
				await suggestionsApi.dismiss(targetId);
			} catch (err) {
				// Не сохранилось — пусть подсказка вернётся, чем потеряться молча.
				set({ dismissedLocal: before, error: (err as Error).message });
			}
		},

		unlinkFrom: async (targetId) => {
			const me = get().graph?.me;
			if (!me) return;
			await optimistic(
				(graph) => ({
					...graph,
					edges: graph.edges.filter(
						([a, b]) =>
							!((a === me && b === targetId) || (b === me && a === targetId)),
					),
				}),
				() => linksApi.remove(targetId),
			);
		},

		select: (selection) => set({ selection }),
		hover: (id) => set({ hovered: id }),
	};
});
