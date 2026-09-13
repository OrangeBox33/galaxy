// Представления сущностей для API. Все id — строки (раздел 3, 10).
import type { User } from '@prisma/client';
import { isAdmin } from '../env.js';
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
};

// Первый вход: человек ещё ничего о себе не указал. Показываем экран профиля
// поверх карты — но пропустить его можно, тогда звезда светится нейтрально-белым.
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
	};
}
