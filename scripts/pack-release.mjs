// Builds the release tarball: the server, the prebuilt UI and express, so a user needs only Node 24 and git.
//   node scripts/pack-release.mjs   →   release/code-akos-v<version>.tar.gz + release/sha256sums.txt
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const name = `code-akos-v${pkg.version}`;
const out = join(root, 'release');
const stage = join(out, name);

const run = (command, args, cwd) => {
  const { status } = spawnSync(command, args, { cwd, stdio: 'inherit' });
  if (status !== 0) process.exit(status ?? 1);
};

rmSync(out, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });

run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['--prefix', 'web', 'run', 'build'], root);

for (const path of ['server', 'bin', 'LICENSE', 'README.md', 'CHANGELOG.md', '.env.example', 'package-lock.json']) {
  cpSync(join(root, path), join(stage, path), { recursive: true });
}
cpSync(join(root, 'web', 'dist'), join(stage, 'web', 'dist'), { recursive: true });
for (const script of ['check-node.mjs', 'ensure-build.mjs', 'setup.mjs', 'setup-checks.mjs', 'env-template.mjs']) {
  cpSync(join(root, 'scripts', script), join(stage, 'scripts', script));
}

// Only what running needs: no dev tooling, and no postinstall that would reach for web/package.json.
const { devDependencies, scripts, ...rest } = pkg;
const shipped = { ...rest, scripts: { start: scripts.start, prestart: scripts.prestart, setup: scripts.setup } };
writeFileSync(join(stage, 'package.json'), `${JSON.stringify(shipped, null, 2)}\n`);

run('npm', ['ci', '--omit=dev', '--ignore-scripts'], stage);

const tarball = `${name}.tar.gz`;
run('tar', ['-czf', tarball, name], out);
rmSync(stage, { recursive: true, force: true });

const sum = createHash('sha256').update(readFileSync(join(out, tarball))).digest('hex');
writeFileSync(join(out, 'sha256sums.txt'), `${sum}  ${tarball}\n`);
console.log(`\n${join(out, tarball)}\n${sum}`);
