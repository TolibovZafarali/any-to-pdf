import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  appType: 'mpa',
  build: { license: { fileName: 'third-party-licenses.txt' } },
});
