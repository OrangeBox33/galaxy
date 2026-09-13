// Состояние клиента: граф, профиль, выбранная звезда — и предсказание раскладки.
//
// Своё действие человек должен видеть немедленно. Сервер же пересчитывает
// карту с задержкой в несколько секунд (он ждёт, пока изменения перестанут
// сыпаться) — поэтому клиент считает предполагаемую раскладку сам, показывает
// её сразу, а когда приходит серверная, звёзды плавно переезжают на неё.
import { create } from 'zustand';
import { graph as graphApi, links as linksApi, me as meApi } from './api/endpoints';
import { predictLayout, type Prediction } from './layout/predict';
import type { Graph, Profile } from './api/types';

type Selection = { kind: 'node'; id: string } | { kind: 'invite'; id: string } | null;

// После своего действия сервер пересчитает карту через несколько секунд.
// Ждать общего опроса раз в тридцать секунд незачем — спрашиваем раньше.
const FOLLOW_UP_MS = [6000, 12000, 20000];

type State = {
	profile: Profile | null;
	graph: Graph | null;
	selection: Selection;
	hovered: string | null;
	error: string | null;

	// Раскладка, посчитанная на клиенте, и версия сервера, от которой
	// она отталкивалась. Серверные координаты младше этой версии
	// не применяем: они описывают карту до нашего действия.
	prediction: { version: number; nodes: Prediction } | null;

	setProfile: (profile: Profile | null) => void;
	refreshProfile: () => Promise<void>;
	refreshGraph: () => Promise<void>;
	linkWith: (targetId: string) => Promise<void>;
	unlinkFrom: (targetId: string) => Promise<void>;
	select: (selection: Selection) => void;
	hover: (id: string | null) => void;
};

// Накладываем предсказание на свежий граф с сервера.
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
	// Опросы вдогонку своему действию: отменяем прежние, чтобы они
	// не накапливались при серии быстрых действий.
	let followUps: ReturnType<typeof setTimeout>[] = [];

	function scheduleFollowUps(): void {
		followUps.forEach(clearTimeout);
		followUps = FOLLOW_UP_MS.map((delay) =>
			setTimeout(() => void get().refreshGraph(), delay),
		);
	}

	// Показать своё изменение немедленно: сначала сам факт (новая линия),
	// затем — посчитанные в отдельном потоке новые места звёзд.
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

		// Расчёт и запрос идут параллельно: ни один не ждёт другого.
		const [predicted] = await Promise.all([
			predictLayout(changed, changed.edges),
			request().catch((err: Error) => {
				// Не получилось — откатываем к тому, что было, и показываем причину.
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

		setProfile: (profile) => set({ profile }),

		refreshProfile: async () => {
			set({ profile: await meApi.get() });
		},

		refreshGraph: async () => {
			try {
				const fresh = await graphApi.get();
				const prediction = get().prediction;

				// Сервер ещё не успел пересчитать — его координаты описывают
				// карту до нашего действия, поэтому оставляем свои.
				if (prediction && fresh.layoutVersion <= prediction.version) {
					set({
						graph: prediction.nodes.size > 0 ? applyPrediction(fresh, prediction.nodes) : fresh,
						error: null,
					});
					return;
				}

				// Пришла серверная раскладка — она и есть истина.
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
