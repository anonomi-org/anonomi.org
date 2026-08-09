export type ReleaseInfo = {
  version: string;
  date: string;
  downloadUrl: string;
  sha256: string;
  sizeMB: string;
};

type GitHubAsset = {
  name: string;
  browser_download_url: string;
  size: number;
  digest: string | null;
};

type GitHubRelease = {
  tag_name: string;
  published_at: string;
  assets: GitHubAsset[];
};

export async function fetchReleases(
  repo: string,
  assetName: string,
  count: number,
): Promise<ReleaseInfo[]> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "anonomi-website-build",
  };

  // Build-time only, so process.env resolves natively — that's the real source.
  // import.meta.env is just for a local .env; Astro won't expose GITHUB_TOKEN
  // there unless it's PUBLIC_-prefixed, which it must never be. Both lookups are
  // guarded, so this stays token-free if it ever reaches a client bundle.
  const token =
    (typeof import.meta !== "undefined" && import.meta.env?.GITHUB_TOKEN) ||
    (typeof process !== "undefined" && process.env?.GITHUB_TOKEN) ||
    "";
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const url = `https://api.github.com/repos/${repo}/releases?per_page=${count}`;

  // Failures here fail the build on purpose. Returning [] instead publishes a
  // downloads page with no downloads and no error, which is worse than not
  // publishing for an app shipped as an APK plus a checksum.
  const res = await fetch(url, { headers });

  if (!res.ok) {
    throw new Error(
      `[releases] ${url} → ${res.status} ${res.statusText}. ` +
        `The downloads page cannot be built. 401 means GITHUB_TOKEN is set but ` +
        `invalid or expired. 403 means the rate limit is gone — a build spends ` +
        `one request per locale per repo, and unauthenticated builds only get ` +
        `60 an hour, so set GITHUB_TOKEN to raise it to 5000.`,
    );
  }

  const releases: GitHubRelease[] = await res.json();
  const results: ReleaseInfo[] = [];

  for (const release of releases) {
    const asset = release.assets.find((a) => a.name === assetName);
    if (!asset) continue;

    const sizeMB = (asset.size / (1000 * 1000)).toFixed(0) + " MB";

    let sha256 = "";
    if (asset.digest) {
      sha256 = asset.digest.replace(/^sha256:/i, "");
    }

    const date = new Date(release.published_at).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });

    results.push({
      version: release.tag_name,
      date,
      downloadUrl: asset.browser_download_url,
      sha256,
      sizeMB,
    });
  }

  if (results.length === 0) {
    throw new Error(
      `[releases] no release in ${repo} carries an asset named "${assetName}". ` +
        `Either the asset was renamed or the latest releases are missing it.`,
    );
  }

  return results;
}
