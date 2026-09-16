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
	needsProfileSetup: boolean;
	// Ссылка постоянная: одна и та же на все входы.
	inviteUrl: string | null;
	shareText: string;
};

// Первый вход: о себе ничего не указано — показываем профиль, но пропустить можно.
function needsSetup(user: User): boolean {
	return user.customName === null && user.age === null && user.gender === 'UNSPECIFIED';
}

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
		needsProfileSetup: needsSetup(user),
		inviteUrl: user.inviteToken ? inviteUrl(user.inviteToken) : null,
		shareText: SHARE_TEXT,
	};
}
