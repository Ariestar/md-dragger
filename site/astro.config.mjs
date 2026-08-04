// @ts-check
import { defineConfig } from 'astro/config';
import { fileURLToPath } from 'node:url';

import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';

const fromSiteRoot = (path) => fileURLToPath(new URL(path, import.meta.url));

// https://astro.build/config
export default defineConfig({
  // GitHub Pages project site: https://ariestar.github.io/md-dragger/
  site: 'https://ariestar.github.io',
  base: '/md-dragger',
  trailingSlash: 'always',

  integrations: [react()],

  vite: {
    plugins: [tailwindcss()],
    resolve: {
      alias: {
        '@codemirror/state': fromSiteRoot('./node_modules/@codemirror/state/dist/index.js'),
        '@codemirror/view': fromSiteRoot('./node_modules/@codemirror/view/dist/index.js'),
        // Same physical language module as ink-mde, otherwise syntaxTree()
        // from a second copy cannot see Table/HR nodes for host previews.
        '@codemirror/language': fromSiteRoot('./node_modules/@codemirror/language/dist/index.js'),
      },
      conditions: ['source'],
      dedupe: ['@codemirror/state', '@codemirror/view', '@codemirror/language'],
    }
  }
});
