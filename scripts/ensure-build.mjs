// Runs before `npm start`: rebuild the UI only if any source is newer than the last build.
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const web = new URL('../web/', import.meta.url).pathname;
const built = join(web, 'dist', 'index.html');

const newest = (path) => {
  const info = statSync(path);
  if (!info.isDirectory()) return info.mtimeMs;
  return Math.max(...readdirSync(path).map((name) => newest(join(path, name))), 0);
};
const sources = ['src', 'index.html', 'package.json', 'vite.config.ts', 'components.json'].map((p) => join(web, p)).filter(existsSync);
const stale = !existsSync(built) || Math.max(...sources.map(newest)) > statSync(built).mtimeMs;

if (stale) {
  console.log('Building the dashboard UI…');
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  if (!existsSync(join(web, 'node_modules'))) spawnSync(npm, ['install'], { cwd: web, stdio: 'inherit' });
  const { status } = spawnSync(npm, ['run', 'build'], { cwd: web, stdio: 'inherit' });
  if (status !== 0) process.exit(status ?? 1);
}
