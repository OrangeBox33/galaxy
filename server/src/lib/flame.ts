// Личный множитель числа языков пламени. Достаётся человеку один раз при
// первом входе и хранится в БД: звезда должна оставаться узнаваемой, а не
// меняться от захода к заходу. Значения — 0.55…1 с шагом 0.05, всего десять
// ступеней: разница между соседними заметна, но ни одна звезда не выпадает
// из общего вида.
const FLAME_MIN = 0.55;
const FLAME_STEP = 0.05;
const FLAME_STEPS = 10;

export function randomFlame(): number {
	const step = Math.floor(Math.random() * FLAME_STEPS);
	return Number((FLAME_MIN + step * FLAME_STEP).toFixed(2));
}
