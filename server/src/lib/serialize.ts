// BigInt не сериализуется в JSON, а все наши id — BigInt.
export function jsonSafe<T>(value: T): unknown {
	if (typeof value === 'bigint') return value.toString();
	if (value instanceof Date) return value.toISOString();
	if (Array.isArray(value)) return value.map(jsonSafe);
	if (value && typeof value === 'object') {
		const out: Record<string, unknown> = {};
		for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
			out[key] = jsonSafe(item);
		}
		return out;
	}
	return value;
}
