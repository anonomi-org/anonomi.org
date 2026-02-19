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
  try {
    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
      "User-Agent": "anonomi-website-build",
    };

    // Astro exposes env vars via import.meta.env; process.env as fallback
    const token =
      (typeof import.meta !== "undefined" && import.meta.env?.GITHUB_TOKEN) ||
      (typeof process !== "undefined" && process.env?.GITHUB_TOKEN) ||
      "";
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const url = `https://api.github.com/repos/${repo}/releases?per_page=${count}`;
    const res = await fetch(url, { headers });

    if (!res.ok) {
      console.warn(`[releases] ${url} → ${res.status} ${res.statusText}`);
      return [];
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

      const date = new Date(release.published_at)
        .toLocaleDateString("en-US", {
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

    return results;
  } catch {
    return [];
  }
}
