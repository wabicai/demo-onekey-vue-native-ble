import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
export default defineConfig({
    plugins: [
        vue(),
        nodePolyfills({
            include: ['buffer', 'process'],
            globals: {
                Buffer: true,
                global: true,
                process: true
            }
        })
    ],
    base: './', // Use relative paths for Capacitor
    server: {
        host: '0.0.0.0',
        port: 5173
    }
});
