// Склеить звезду из Макса с телеграмной того же человека: руками, по просьбе.
//   node server/src/lib/mergeMax.js <telegram id> <id звезды из Макса> [--dry]
//
// Звезда из Макса удаляется, её связи переходят телеграмной, а та получает maxId:
// вход из Макса дальше ведёт в неё.
import { db } from '../db.js';
import { displayName } from './names.js';
import { normalizePair } from './pair.js';
import { markLayoutDirty } from '../layout/state.js';
import { isFromMax } from '../bot/max.js';

async function merge(telegramId: bigint, maxStarId: bigint, dry: boolean): Promise<void> {
	const tg = await db.user.findUnique({ where: { id: telegramId } });
	const max = await db.user.findUnique({ where: { id: maxStarId } });
	if (!tg || isFromMax(tg.id)) throw new Error(`${telegramId} — не телеграмная звезда`);
	if (!max || !isFromMax(max.id) || max.maxId === null) {
		throw new Error(`${maxStarId} — не звезда из Макса`);
	}
	if (tg.maxId !== null) throw new Error(`${displayName(tg)} уже склеен с Максом`);

	const links = await db.link.findMany({
		where: { OR: [{ aId: max.id }, { bId: max.id }] },
	});
	const peers = links
		.map((link) => ({ peer: link.aId === max.id ? link.bId : link.aId, by: link.createdById }))
		.filter(({ peer }) => peer !== tg.id);

	console.log(`${displayName(max)} (${max.id}) → ${displayName(tg)} (${tg.id})`);
	console.log(`  связей переходит: ${peers.length}`);
	if (dry) {
		console.log('Ничего не тронуто: это пробный прогон.');
		return;
	}

	await db.$transaction(async (tx) => {
		await tx.user.delete({ where: { id: max.id } });
		await tx.user.update({ where: { id: tg.id }, data: { maxId: max.maxId } });

		for (const { peer, by } of peers) {
			const [aId, bId] = normalizePair(tg.id, peer);
			if (await tx.link.findUnique({ where: { aId_bId: { aId, bId } } })) continue;
			await tx.link.create({ data: { aId, bId, createdById: by === max.id ? tg.id : by } });
		}

		for (const id of [tg.id, ...peers.map(({ peer }) => peer)]) {
			const degree = await tx.link.count({ where: { OR: [{ aId: id }, { bId: id }] } });
			await tx.user.update({ where: { id }, data: { degree } });
		}
		await markLayoutDirty(tx);
	});

	console.log('Склеено. Раскладка пересчитается сама.');
}

async function main(): Promise<void> {
	const [tg, max, ...rest] = process.argv.slice(2);
	if (tg && max && /^\d+$/.test(tg) && /^\d+$/.test(max)) {
		await merge(BigInt(tg), BigInt(max), rest.includes('--dry'));
	} else {
		console.log('Использование: mergeMax.js <telegram id> <id звезды из Макса> [--dry]');
		process.exitCode = 1;
	}
	await db.$disconnect();
}

main().catch(async (err: Error) => {
	console.error(`Не вышло: ${err.message}`);
	await db.$disconnect();
	process.exit(1);
});
