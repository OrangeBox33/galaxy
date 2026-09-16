import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { BASE_PATH } from '../shared/config';

// base обязателен: без него бандл запросит /assets/* у соседнего приложения домена.
export default defineConfig({
	base: `${BASE_PATH}/`,
	plugins: [react()],
	build: {
		outDir: 'dist',
		emptyOutDir: true,
		sourcemap: false,
	},
	server: {
		port: 3006,
	},
});
