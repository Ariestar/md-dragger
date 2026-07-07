// @ts-check
import { defineConfig } from 'astro/config';
import { fileURLToPath } from 'node:url';

import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';

const fromSiteRoot = (path) => fileURLToPath(new URL(path, import.meta.url));

// https://astro.build/config
export default defineConfig({
  integrations: [react()],

  vite: {
    plugins: [tailwindcss()],
    resolve: {
      alias: {
        '@codemirror/state': fromSiteRoot('./node_modules/@codemirror/state/dist/index.js'),
        '@codemirror/view': fromSiteRoot('./node_modules/@codemirror/view/dist/index.js')
      },
      conditions: ['source'],
      dedupe: ['@codemirror/state', '@codemirror/view']
    }
  }
});
