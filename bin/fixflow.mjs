#!/usr/bin/env node
// Starts FixFlow from a release tarball or a clone. The Node check comes first and the server is imported
// dynamically, because a Node too old to run TypeScript cannot even load server/main.ts to print a message.
import '../scripts/check-node.mjs';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

if (!existsSync(fileURLToPath(new URL('../web/dist/index.html', import.meta.url)))) {
  console.error('The dashboard UI has not been built. From a clone, run `npm start` (it builds the UI) or `npm run build`.');
  process.exit(1);
}

await import('../server/main.ts');
