// Холодный старт: админ пересылает боту сообщение друга, и звезда друга
// загорается заранее, сразу связанная с админом. Вторую связь, без которой
// не будет предложки, админ ставит в админке.
import { db } from '../db.js';
import { escapeHtml } from '../bot/outbox.js';
import { displayName, sanitizeIncoming } from './names.js';
import { randomFlame } from './flame.js';
import { normalizePair } from './pair.js';
import { ensureInviteToken } from './inviteLink.js';
import { markLayoutDirty } from '../layout/state.js';

export type ForwardOrigin = {
	type?: string;
	sender_user?: {
		id?: number;
		is_bot?: boolean;
		username?: string;
		first_name?: string;
		last_name?: string;
	};
	sender_user_name?: string;
};

// Уведомлений нет: человек бота ещё не открывал, писать ему некуда.
export async function seedFriend(adminId: bigint, origin: ForwardOrigin): Promise<string> {
	if (origin.type !== 'user' && origin.type !== 'hidden_user') {
		return 'Это пересылка из канала или группы, а не от человека.';
	}
	const friend = origin.sender_user;
	if (!friend?.id) {
		const name = escapeHtml(origin.sender_user_name ?? 'Этот человек');
		return `${name} закрыл пересылку в настройках конфиденциальности: id не видно, завести нельзя.`;
	}
	if (friend.is_bot) return 'Это бот, на небо не завожу.';

	const id = BigInt(friend.id);
	if (id === adminId) return 'Это твоё же сообщение.';

	const result = await db.$transaction(async (tx) => {
		let user = await tx.user.findUnique({ where: { id } });
		const isNew = !user;
		if (!user) {
			user = await tx.user.create({
				data: {
					id,
					flame: randomFlame(),
					telegramUsername: friend.username ?? null,
					telegramFirstName: sanitizeIncoming(friend.first_name),
					telegramLastName: sanitizeIncoming(friend.last_name),
				},
			});
			await markLayoutDirty(tx);
		}
		if (user.isBlocked) return { user, isNew, linked: false, blocked: true };
		user = await ensureInviteToken(tx, user);

		const [aId, bId] = normalizePair(adminId, id);
		if (await tx.link.findUnique({ where: { aId_bId: { aId, bId } } })) {
			return { user, isNew, linked: false, blocked: false };
		}
		await tx.link.create({ data: { aId, bId, createdById: adminId } });
		await tx.user.update({ where: { id: aId }, data: { degree: { increment: 1 } } });
		await tx.user.update({ where: { id: bId }, data: { degree: { increment: 1 } } });
		await markLayoutDirty(tx);
		return { user, isNew, linked: true, blocked: false };
	});

	const who = `<b>${escapeHtml(displayName(result.user))}</b> · <code>${id}</code>`;
	if (result.blocked) return `${who} заблокирован, связь не ставлю.`;
	const star = result.isNew ? 'заведён' : 'уже был на небе';
	const link = result.linked ? 'связан с тобой' : 'с тобой уже связан';
	return `${who}: ${star}, ${link}.`;
}
