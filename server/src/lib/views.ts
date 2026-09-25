import type { User } from '@prisma/client';
import { isAdmin } from '../env.js';
import { inviteUrl, SHARE_TEXT } from './inviteLink.js';
import { displayName } from './names.js';

export type ProfileView = {
	id: string;
	name: string;
	age: number | null;
	gender: User['gender'];
	avatar: string | null;
	isAdmin: boolean;
	isTest: boolean;
	nameLockedByAdmin: boolean;
	// Первый вход: показать окно профиля, а после него — рождение звезды.
	needsBirth: boolean;
	coreColor: string | null;
	flameColor: string | null;
	// Ссылка постоянная: одна и та же на все входы.
	inviteUrl: string | null;
	shareText: string;
};

export function toProfile(user: User): ProfileView {
	return {
		id: user.id.toString(),
		name: displayName(user),
		age: user.age,
		gender: user.gender,
		avatar: user.avatarFile,
		isAdmin: isAdmin(user.id),
		isTest: user.isTest,
		nameLockedByAdmin: user.nameLockedByAdmin,
		needsBirth: !user.bornSeen,
		coreColor: user.coreColor,
		flameColor: user.flameColor,
		inviteUrl: user.inviteToken ? inviteUrl(user.inviteToken) : null,
		shareText: SHARE_TEXT,
	};
}
