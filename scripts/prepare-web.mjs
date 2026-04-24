import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '..');
const outDir = join(rootDir, 'www');

const entriesToCopy = [
  'index.html',
  'data',
  'src',
  'styles',
  'assets',
];

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

for (const entry of entriesToCopy) {
  const source = join(rootDir, entry);
  if (!existsSync(source)) continue;

  const target = join(outDir, entry);
  const stats = statSync(source);
  if (stats.isDirectory()) {
    cpSync(source, target, { recursive: true });
  } else {
    cpSync(source, target);
  }
}

const copied = readdirSync(outDir);
console.log(`[build:web] Prepared ${outDir} with: ${copied.join(', ')}`);
