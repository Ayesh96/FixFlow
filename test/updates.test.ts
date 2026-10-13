import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { describe, it } from 'node:test';

const { compareVersions, assetFor, findUpdate, RELEASES_API } = createRequire(import.meta.url)('../desktop/updates.js');

const ASSETS = ['code-akos-1.2.0-mac-arm64.dmg', 'code-akos-1.2.0-mac-x64.dmg', 'code-akos-1.2.0-win-x64.exe', 'code-akos-1.2.0-linux-x86_64.AppImage', 'code-akos-v1.2.0.tar.gz', 'sha256sums.txt'].map(
  (name) => ({ name, browser_download_url: `https://example.test/${name}` }),
);

const github = (release: object, status = 200) => {
  const calls: string[] = [];
  const fetchImpl = async (url: string) => {
    calls.push(url);
    return { ok: status === 200, status, json: async () => release };
  };
  return { calls, fetchImpl };
};

describe('compareVersions', () => {
  it('orders versions by number, not by text', () => {
    assert.equal(compareVersions('1.10.0', '1.9.9'), 1);
    assert.equal(compareVersions('1.1.1', '1.2.0'), -1);
    assert.equal(compareVersions('v1.2.0', '1.2.0'), 0);
    assert.equal(compareVersions('1.2', '1.2.0'), 0);
    assert.equal(compareVersions('2.0.0-beta.1', '2.0.0'), 0);
  });
});

describe('assetFor', () => {
  it('picks the file for each computer', () => {
    assert.equal(assetFor(ASSETS, 'darwin', 'arm64').name, 'code-akos-1.2.0-mac-arm64.dmg');
    assert.equal(assetFor(ASSETS, 'darwin', 'x64').name, 'code-akos-1.2.0-mac-x64.dmg');
    assert.equal(assetFor(ASSETS, 'win32', 'x64').name, 'code-akos-1.2.0-win-x64.exe');
    assert.equal(assetFor(ASSETS, 'linux', 'x64').name, 'code-akos-1.2.0-linux-x86_64.AppImage');
  });

  it('matches releases from before the rename too', () => {
    assert.equal(assetFor([{ name: 'FixFlow-1.1.1-mac-arm64.dmg' }], 'darwin', 'arm64').name, 'FixFlow-1.1.1-mac-arm64.dmg');
  });

  it('gives nothing for a computer no build exists for', () => {
    assert.equal(assetFor(ASSETS, 'linux', 'arm64'), null);
    assert.equal(assetFor(ASSETS, 'freebsd', 'x64'), null);
  });
});

describe('findUpdate', () => {
  const release = { tag_name: 'v1.2.0', html_url: 'https://github.com/Ayesh96/code-akos/releases/tag/v1.2.0', assets: ASSETS };

  it('reports a newer release with this computer\'s file', async () => {
    const { calls, fetchImpl } = github(release);
    const update = await findUpdate({ current: '1.1.1', platform: 'darwin', arch: 'arm64', fetchImpl });
    assert.deepEqual(update, { version: '1.2.0', url: 'https://example.test/code-akos-1.2.0-mac-arm64.dmg', page: release.html_url });
    assert.deepEqual(calls, [RELEASES_API]);
  });

  it('falls back to the release page when there is no file for this computer', async () => {
    const update = await findUpdate({ current: '1.1.1', platform: 'linux', arch: 'arm64', fetchImpl: github(release).fetchImpl });
    assert.equal(update.url, release.html_url);
  });

  it('reports nothing when this version is the latest or newer', async () => {
    assert.equal(await findUpdate({ current: '1.2.0', platform: 'win32', arch: 'x64', fetchImpl: github(release).fetchImpl }), null);
    assert.equal(await findUpdate({ current: '1.3.0', platform: 'win32', arch: 'x64', fetchImpl: github(release).fetchImpl }), null);
  });

  it('throws when GitHub does not answer with a release', async () => {
    await assert.rejects(findUpdate({ current: '1.1.1', platform: 'win32', arch: 'x64', fetchImpl: github({}, 403).fetchImpl }), /GitHub answered 403/);
  });
});
