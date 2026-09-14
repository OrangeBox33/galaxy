// Типы ответов API. Все id — строки (раздел 3 ТЗ).
import type { Gender } from '../../../shared/config';

export type Profile = {
	id: string;
	name: string;
	age: number | null;
	gender: Gender;
	avatar: string | null;
	isAdmin: boolean;
	isTest: boolean;
	nameLockedByAdmin: boolean;
	needsProfileSetup: boolean;
};

export type GraphNode = {
	id: string;
	name: string;
	gender: Gender;
	age: number | null;
	degree: number;
	// Личный множитель числа языков пламени, 0.55…1 (раздел «Рендер»).
	flame: number;
	centrality: number;
	x: number;
	y: number;
	avatar: string | null;
	isTest: boolean;
	isBlocked: boolean;
};

export type PendingInvite = {
	id: string;
	token: string;
	label: string | null;
	createdAt: string;
};

export type Graph = {
	layoutVersion: number;
	me: string;
	nodes: GraphNode[];
	edges: [string, string][];
	pending: PendingInvite[];
};

export type CreatedInvite = {
	id: string;
	token: string;
	url: string;
	shareText: string;
};

export type AdminUser = {
	id: string;
	name: string;
	customName: string | null;
	username: string | null;
	age: number | null;
	gender: Gender;
	avatar: string | null;
	isTest: boolean;
	isBlocked: boolean;
	nameLockedByAdmin: boolean;
	links: number;
	invitesSent: number;
	invitesAccepted: number;
	createdAt: string;
	lastSeenAt: string;
};

export type AdminLink = {
	id: string;
	otherId: string;
	otherName: string;
	createdAt: string;
};
