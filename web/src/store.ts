// Состояние клиента. zustand, без магии: граф, профиль и выбранная звезда.
import { create } from 'zustand';
import { graph as graphApi, me as meApi } from './api/endpoints';
import type { Graph, Profile } from './api/types';

type Selection = { kind: 'node'; id: string } | { kind: 'invite'; id: string } | null;

type State = {
	profile: Profile | null;
	graph: Graph | null;
	selection: Selection;
	hovered: string | null;
	error: string | null;

	setProfile: (profile: Profile | null) => void;
	refreshProfile: () => Promise<void>;
	refreshGraph: () => Promise<void>;
	select: (selection: Selection) => void;
	hover: (id: string | null) => void;
};

export const useStore = create<State>((set) => ({
	profile: null,
	graph: null,
	selection: null,
	hovered: null,
	error: null,

	setProfile: (profile) => set({ profile }),

	refreshProfile: async () => {
		const profile = await meApi.get();
		set({ profile });
	},

	refreshGraph: async () => {
		try {
			const graph = await graphApi.get();
			set({ graph, error: null });
		} catch (err) {
			set({ error: (err as Error).message });
		}
	},

	select: (selection) => set({ selection }),
	hover: (id) => set({ hovered: id }),
}));
