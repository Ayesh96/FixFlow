// Looks for a newer Code Akos on GitHub. Nothing is installed automatically: the user downloads the
// new version and installs it over this one, as with the first install. Auto-install would need a
// signed and notarized macOS build, which this project does not have yet.

const RELEASES_API = 'https://api.github.com/repos/Ayesh96/code-akos/releases/latest';

/** -1, 0 or 1. `v1.2.0` and `1.2.0` are the same; missing parts count as 0; anything after `-` is ignored. */
function compareVersions(a, b) {
  const parts = (v) => String(v).replace(/^v/i, '').split('-')[0].split('.').map((n) => Number.parseInt(n, 10) || 0);
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d !== 0) return d > 0 ? 1 : -1;
  }
  return 0;
}

/**
 * The release file for this computer, matched on the end of its name so it works for every naming
 * the releases have used. Null when there is none (an unbuilt platform): the release page serves instead.
 */
function assetFor(assets, platform, arch) {
  const pattern =
    platform === 'darwin' ? (arch === 'arm64' ? /mac-arm64\.dmg$/i : /mac-x64\.dmg$/i)
    : platform === 'win32' ? /\.exe$/i
    : platform === 'linux' && arch === 'x64' ? /x86_64\.AppImage$/i
    : null;
  return (pattern && assets.find((asset) => pattern.test(asset.name))) || null;
}

/**
 * `{ version, url, page }` when GitHub's latest release is newer than `current`, else null.
 * `url` is this computer's file, or the release page when there is none. Throws when GitHub can't be reached.
 */
async function findUpdate({ current, platform, arch, fetchImpl = fetch, timeoutMs = 10_000 }) {
  const res = await fetchImpl(RELEASES_API, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'code-akos' },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
  const release = await res.json();
  const version = String(release.tag_name ?? '').replace(/^v/i, '');
  if (!version || compareVersions(version, current) <= 0) return null;
  const asset = assetFor(release.assets ?? [], platform, arch);
  return { version, url: asset ? asset.browser_download_url : release.html_url, page: release.html_url };
}

module.exports = { RELEASES_API, compareVersions, assetFor, findUpdate };
