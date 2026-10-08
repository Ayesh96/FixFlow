// `npm run dev`: API server with auto-restart + Vite dev server with hot reload (http://localhost:5173).
import { spawn } from 'node:child_process';

try {
  process.loadEnvFile?.();
} catch {
  // Ignore if .env doesn't exist
}

const run = (cmd, args, cwd) => spawn(cmd, args, { cwd, stdio: 'inherit' });
const children = [
  run(process.execPath, ['--watch', 'server/main.ts'], new URL('..', import.meta.url).pathname),
  run('npx', ['vite'], new URL('../web/', import.meta.url).pathname),
];
const stop = () => children.forEach((c) => c.kill());
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
children.forEach((c) => c.on('exit', stop));
