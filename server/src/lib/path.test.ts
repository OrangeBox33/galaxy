// Цепочка знакомств: математика лежит в shared, её крутит клиент.
import { describe, expect, it } from 'vitest';
import { mutualFriends, neighbourMap, shortestPath } from '../../../shared/path.js';

describe('цепочка знакомств', () => {
	// Я (1) знаком с 2 и 3, оба знают 4, а 4 знает 5. До 6 дороги нет.
	const edges: [string, string][] = [
		['1', '2'],
		['1', '3'],
		['2', '4'],
		['3', '4'],
		['4', '5'],
	];
	const neighbours = neighbourMap(edges);

	it('ведёт кратчайшим путём', () => {
		expect(shortestPath(neighbours, '1', '5')).toHaveLength(4);
		expect(shortestPath(neighbours, '1', '2')).toEqual(['1', '2']);
	});

	it('выбирает один и тот же путь из равных', () => {
		const first = shortestPath(neighbourMap(edges), '1', '4');
		const shuffled = shortestPath(neighbourMap([...edges].reverse()), '1', '4');
		expect(first).toEqual(shuffled);
	});

	it('молчит, когда дороги нет', () => {
		expect(shortestPath(neighbours, '1', '6')).toBeNull();
	});

	it('считает общих друзей', () => {
		expect(mutualFriends(neighbours, '1', '4')).toBe(2);
		expect(mutualFriends(neighbours, '1', '5')).toBe(0);
	});
});
