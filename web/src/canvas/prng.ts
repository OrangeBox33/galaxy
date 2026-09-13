// Тот же генератор, что и на сервере: пыль, фазы дрейфа и углы тусклых точек
// обязаны быть одинаковыми при каждом заходе.
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

// Устойчивое число из строки: id пользователя или токена приглашения.
export function hashString(value: string): number {
	let hash = 2166136261;
	for (let i = 0; i < value.length; i += 1) {
		hash ^= value.charCodeAt(i);
		hash = Math.imul(hash, 16777619);
	}
	return hash >>> 0;
}

export function randomFor(value: string, salt = 0): () => number {
	return mulberry32((hashString(value) ^ Math.imul(salt, 0x85ebca6b)) >>> 0);
}
