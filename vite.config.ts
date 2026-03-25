import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [sveltekit(), tailwindcss()],
	ssr: {
		external: ['@prisma/client', '.prisma/client'],
		noExternal: []
	},
	build: {
		rollupOptions: {
			external: [/^@prisma/, /\.prisma/]
		}
	}
});
