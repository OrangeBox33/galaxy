// Math.random() в раскладке запрещён (раздел 7.5): небо обязано получаться
// одинаковым при одинаковых данных.
export function mulberry32(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

export function prngForId(id: bigint, salt = 0): () => number {
	const mixed = Number(BigInt.asUintN(32, id * 0x9e3779b1n)) ^ (salt * 0x85ebca6b);
	return mulberry32(mixed >>> 0);
}
