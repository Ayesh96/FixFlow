import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { moveLegacyDataDir } from '../server/config.ts';

const home = () => mkdtemp(join(tmpdir(), 'code-akos-home-'));

describe('moveLegacyDataDir', () => {
  it('moves ~/.fixflow to ~/.code-akos once, keeping its files', async () => {
    const dir = await home();
    await mkdir(join(dir, '.fixflow'));
    await writeFile(join(dir, '.fixflow', 'projects.db'), 'data');
    assert.equal(moveLegacyDataDir({}, dir), join(dir, '.code-akos'));
    assert.equal(await readFile(join(dir, '.code-akos', 'projects.db'), 'utf8'), 'data');
    assert.equal(existsSync(join(dir, '.fixflow')), false);
    assert.equal(moveLegacyDataDir({}, dir), null, 'nothing left to move');
  });

  it('leaves both alone when ~/.code-akos already exists', async () => {
    const dir = await home();
    await mkdir(join(dir, '.fixflow'));
    await mkdir(join(dir, '.code-akos'));
    assert.equal(moveLegacyDataDir({}, dir), null);
    assert.equal(existsSync(join(dir, '.fixflow')), true);
  });

  it('does nothing when the data folder is set explicitly', async () => {
    const dir = await home();
    await mkdir(join(dir, '.fixflow'));
    assert.equal(moveLegacyDataDir({ ORCH_DATA_DIR: join(dir, 'elsewhere') }, dir), null);
    assert.equal(existsSync(join(dir, '.fixflow')), true);
  });

  it('does nothing on a fresh install', async () => {
    assert.equal(moveLegacyDataDir({}, await home()), null);
  });
});
