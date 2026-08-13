export type ReleaseInfo = {
  version: string;
  date: string;
  downloadUrl: string;
  sha256: string;
  sizeMB: string;
  /** The APK's filename on this specific release. Repos rename their asset
   *  between versions, so the onion mirror URL has to be built from the name
   *  the release actually carries, not from one hardcoded per repo. */
  assetName: string;
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

// Every locale renders the same downloads page, so this module gets called once
// per locale per repo for only two distinct URLs. A static build is a single
// Node process, so caching the in-flight promise here collapses 12 requests into
// 2 and keeps the rate limit far out of reach.
const releaseLists = new Map<string, Promise<GitHubRelease[]>>();

function githubHeaders(): Record<string, string> {
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

  return headers;
}

function fetchReleaseList(url: string): Promise<GitHubRelease[]> {
  const cached = releaseLists.get(url);
  if (cached) return cached;

  // Failures here fail the build on purpose. Returning [] instead publishes a
  // downloads page with no downloads and no error, which is worse than not
  // publishing for an app shipped as an APK plus a checksum.
  const pending = (async () => {
    const res = await fetch(url, { headers: githubHeaders() });

    if (!res.ok) {
      throw new Error(
        `[releases] ${url} → ${res.status} ${res.statusText}. ` +
          `The downloads page cannot be built. 401 means GITHUB_TOKEN is set but ` +
          `invalid or expired. 403 means the rate limit is gone — unauthenticated ` +
          `builds get 60 requests an hour, so set GITHUB_TOKEN to raise it to 5000.`,
      );
    }

    return (await res.json()) as GitHubRelease[];
  })();

  releaseLists.set(url, pending);
  return pending;
}

/**
 * @param assetNames Every filename the APK is published under, newest naming
 *   first. A release is matched by the first of these it carries, so a repo that
 *   renames its asset keeps listing both its new and its older releases.
 */
export async function fetchReleases(
  repo: string,
  assetNames: string | string[],
  count: number,
): Promise<ReleaseInfo[]> {
  const accepted = Array.isArray(assetNames) ? assetNames : [assetNames];
  const url = `https://api.github.com/repos/${repo}/releases?per_page=${count}`;
  const releases = await fetchReleaseList(url);
  const results: ReleaseInfo[] = [];

  for (const release of releases) {
    let asset: GitHubAsset | undefined;
    for (const name of accepted) {
      asset = release.assets.find((a) => a.name === name);
      if (asset) break;
    }
    if (!asset) {
      // A renamed asset drops the release from the page without failing the
      // build, so name it in the log rather than losing it silently.
      console.warn(
        `[releases] ${repo} ${release.tag_name} carries none of ` +
          `${accepted.join(", ")} — skipped. Its assets: ` +
          `${release.assets.map((a) => a.name).join(", ") || "(none)"}`,
      );
      continue;
    }

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
      assetName: asset.name,
    });
  }

  if (results.length === 0) {
    throw new Error(
      `[releases] no release in ${repo} carries an asset named ` +
        `${accepted.map((n) => `"${n}"`).join(" or ")}. ` +
        `Either the asset was renamed or the latest releases are missing it.`,
    );
  }

  return results;
}
