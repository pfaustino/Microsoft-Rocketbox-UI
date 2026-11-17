import { defineConfig } from 'vite';
import { rocketboxPlugin } from './server/rocketboxPlugin.mjs';

export default defineConfig({
  plugins: [rocketboxPlugin()],
  server: { port: 5173 },
  preview: { port: 4173 },
});
