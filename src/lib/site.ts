/**
 * Which network this build is for, and the links that follow from it.
 *
 * The onion deploy and the GitHub Pages workflow each set
 * `PUBLIC_SITE_BASE_URL` to their own origin, so the build already knows which
 * of a link's two forms its visitors can open. Picking here rather than
 * swapping in the browser means the right link is in the HTML: it survives
 * JavaScript being turned off, and there is no flash of the wrong one.
 *
 * The pure helpers take their input as an argument so they can be tested
 * outside Astro and Vite. Only the constants below read the environment.
 */

export type Network = "onion" | "local" | "clearnet";

/** Hostname of a URL, or "" if it cannot be parsed. */
export function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

/**
 * Which network a site base URL belongs to.
 *
 * Anything unrecognised counts as clearnet, so a host we do not know about
 * fails closed rather than being handed the onion-only behaviour.
 */
export function networkOf(siteBaseUrl: string): Network {
  const host = hostnameOf(siteBaseUrl);
  if (host.endsWith(".onion")) return "onion";
  if (host === "localhost" || host === "127.0.0.1") return "local";
  return "clearnet";
}

/** Pick the variant a visitor on `network` can actually reach. */
export function pickForNetwork<T>(network: Network, onion: T, clearnet: T): T {
  return network === "onion" ? onion : clearnet;
}

// Guarded the same way as releases.ts: this module is also loaded by the test
// runner, which runs outside Vite and has no import.meta.env.
const SITE_BASE =
  (typeof import.meta !== "undefined" && import.meta.env?.PUBLIC_SITE_BASE_URL) ||
  "http://localhost:4321";

export const SITE_NETWORK: Network = networkOf(SITE_BASE);

/** The onion deploy: the only build that ships working Paylinks forms. */
export const IS_ONION_BUILD = SITE_NETWORK === "onion";

/** A developer's machine, running `astro dev` or a local production build. */
export const IS_LOCAL_BUILD = SITE_NETWORK === "local";

/**
 * Pick the variant this build's visitors can reach.
 *
 * Use for any link that exists on both networks:
 *   href={net(onionUrl, clearnetUrl)}
 */
export function net<T>(onion: T, clearnet: T): T {
  return pickForNetwork(SITE_NETWORK, onion, clearnet);
}

// --- Canonical addresses ----------------------------------------------------
// Kept here so rotating one is a single edit rather than a sweep of the pages.

/** Onion entry point for the website. */
export const ONION_SITE_BASE =
  "http://dwbgp2zfjqxcrk6fk3j7tr5uyqes4lxkipnsvm6atyi5eo7smsa6ykqd.onion";

/** Onion code repository, up to and including the org. */
export const ONION_REPO_BASE =
  "http://ll7nb2gloylmzcnb4q6apax6zt4c5gbdvx73cvf7fj4frep7zsgdeoqd.onion/anonomi";

/** Clearnet code repository, up to and including the org. */
export const CLEARNET_REPO_BASE = "https://github.com/anonomi-org";

/**
 * A repository URL for this build's network.
 *
 * The onion mirror and GitHub share a path layout below the org, so one
 * argument covers both:
 *   repoUrl()                                  → the org
 *   repoUrl("anonomi.org")                     → one repository
 *   repoUrl("anonomi-android/releases/latest") → a path inside one
 */
export function repoUrl(path = ""): string {
  const suffix = path ? `/${path}` : "";
  return net(ONION_REPO_BASE + suffix, CLEARNET_REPO_BASE + suffix);
}

// --- This build -------------------------------------------------------------

/** Commit the site was built from. The deploys export it; a local build has none. */
export const BUILD_SHA =
  (typeof import.meta !== "undefined" && import.meta.env?.PUBLIC_BUILD_SHA) || "";

/** What the build stamp shows. */
export const BUILD_SHORT = BUILD_SHA ? BUILD_SHA.slice(0, 7) : "dev";

/** This build's commit, or the repository itself when the sha is unknown. */
export function buildCommitUrl(): string {
  return repoUrl(BUILD_SHA ? `anonomi.org/commit/${BUILD_SHA}` : "anonomi.org");
}
