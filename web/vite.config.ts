import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { BASE_PATH } from '../shared/config';

// base обязателен: без него бандл запросит /assets/* и получит соседнее
// приложение того же домена (раздел 2.2 ТЗ).
export default defineConfig({
	base: `${BASE_PATH}/`,
	plugins: [react()],
	build: {
		outDir: 'dist',
		emptyOutDir: true,
		// Исходники в проде не нужны, а место на VPS не резиновое.
		sourcemap: false,
	},
	server: {
		port: 3006,
	},
});
