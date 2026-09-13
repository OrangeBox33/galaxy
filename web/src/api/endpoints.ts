// Типизированные вызовы API. Пути пишутся здесь один раз.
import { api } from './client';
import type { AdminLink, AdminUser, CreatedInvite, Graph, Profile } from './types';
import type { Gender } from '../../../shared/config';

export const auth = {
	telegram: (initData: string) => api.post<Profile>('/auth/telegram', { initData }),
	logout: () => api.post<void>('/auth/logout'),
};

export const me = {
	get: () => api.get<Profile>('/me'),
	update: (patch: { displayName?: string; age?: number | null; gender?: Gender }) =>
		api.patch<Profile>('/me', patch),
	remove: () => api.del<void>('/me'),
};

export const graph = {
	get: () => api.get<Graph>('/graph'),
};

export const invites = {
	create: (label?: string) => api.post<CreatedInvite>('/invites', label ? { label } : {}),
	revoke: (id: string) => api.del<void>(`/invites/${id}`),
};

export const links = {
	create: (targetId: string) => api.post<{ ok: true }>('/links', { targetId }),
	remove: (targetId: string) => api.del<void>(`/links/${targetId}`),
};

export const admin = {
	users: () => api.get<AdminUser[]>('/admin/users'),
	userLinks: (id: string) => api.get<AdminLink[]>(`/admin/users/${id}/links`),
	createTest: (payload: { name: string; age?: number | null; gender?: Gender }) =>
		api.post<{ id: string; name: string }>('/admin/users', payload),
	update: (
		id: string,
		patch: { displayName?: string; age?: number | null; gender?: Gender; isBlocked?: boolean },
	) => api.patch<{ id: string; name: string }>(`/admin/users/${id}`, patch),
	remove: (id: string) => api.del<void>(`/admin/users/${id}`),
	createLink: (aId: string, bId: string) => api.post<{ ok: true }>('/admin/links', { aId, bId }),
	removeLink: (aId: string, bId: string) => api.del<void>('/admin/links', { aId, bId }),
	recompute: (mode: 'full' | 'warm') =>
		api.post<{ version: number; nodes: number; ms: number; mode: string }>(
			'/admin/layout/recompute',
			{ mode },
		),
};
