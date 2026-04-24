import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const rootDir = resolve(fileURLToPath(new URL('..', import.meta.url)));
const androidDir = resolve(rootDir, 'android');

if (existsSync(androidDir)) {
  console.log('[ensure:android] Android platform already exists');
  process.exit(0);
}

console.log('[ensure:android] Adding Android platform...');
const command = process.platform === 'win32' ? 'cmd' : 'npx';
const args = process.platform === 'win32'
  ? ['/c', 'npx', 'cap', 'add', 'android']
  : ['cap', 'add', 'android'];

const result = spawnSync(command, args, {
  cwd: rootDir,
  stdio: 'inherit',
  shell: false,
});

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}
