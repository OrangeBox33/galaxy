import type { Prisma } from '@prisma/client';
import type { SERVER_EVENTS } from '../../../shared/analytics.js';

export async function track(
	tx: Prisma.TransactionClient,
	userId: bigint,
	type: (typeof SERVER_EVENTS)[number],
	detail?: string,
): Promise<void> {
	await tx.analyticsEvent.create({ data: { userId, type, detail } });
}
