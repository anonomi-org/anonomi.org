/**
 * Paylinks is an onion-only service.
 *
 * The Paylinks API is reachable only as a Tor onion service, and it pins
 * `ALLOWED_ORIGINS` to the onion website origin. A clearnet build therefore
 * cannot reach it at all — every request fails CORS before it is answered.
 *
 * The previous clearnet API host (`paylinksd.anonomi.org`) has been
 * decommissioned. Shipping a form that posts a Monero address to a hostname
 * the project no longer controls is worse than shipping no form, so the
 * clearnet build renders an explanatory notice in place of the Paylinks
 * forms rather than a UI that silently fails.
 *
 * The network is derived from `PUBLIC_SITE_BASE_URL`, which the onion deploy
 * (`deploy-onion.sh`) and the GitHub Pages workflow already set to their
 * respective origins — no additional build flag to keep in sync. Anything
 * that is neither an onion origin nor local development is treated as
 * clearnet, so an unrecognised host fails closed.
 */

const SITE_BASE = import.meta.env.PUBLIC_SITE_BASE_URL ?? "http://localhost:4321";

/** Canonical onion entry point for Paylinks, shown to clearnet visitors. */
export const PAYLINKS_ONION_BASE =
  "http://dwbgp2zfjqxcrk6fk3j7tr5uyqes4lxkipnsvm6atyi5eo7smsa6ykqd.onion";

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

const host = hostnameOf(SITE_BASE);

/** The onion deploy: the only build that ships working Paylinks forms. */
const IS_ONION_BUILD = host.endsWith(".onion");

/** A developer's machine, running `astro dev` or a local production build. */
const IS_LOCAL_BUILD = host === "localhost" || host === "127.0.0.1";

/**
 * True only for builds whose origin can actually reach the Paylinks API:
 * the onion site, or a local development server.
 */
export const PAYLINKS_ENABLED = IS_ONION_BUILD || IS_LOCAL_BUILD;

/**
 * Base URL of the Paylinks API for this build.
 *
 * Pages must use this rather than their own `?? "http://localhost:8787"`. That
 * default is how a deploy ends up pointing donors at their own machine — the
 * page renders fine, the fetch just goes somewhere we don't control.
 */
export function paylinksApiBase(): string {
  const base = import.meta.env.PUBLIC_PAYLINKS_API_BASE;
  if (base) return base;

  // Clearnet has no API base on purpose (see above, and deploy.yml). It shows
  // the onion notice instead of the forms, so there is nothing to point at.
  if (!IS_ONION_BUILD) {
    if (IS_LOCAL_BUILD) return "http://localhost:8787";
    return "";
  }

  // Frontmatter runs at build time, so this fails `astro build` rather than
  // shipping a donate page aimed at each visitor's localhost.
  throw new Error(
    "PUBLIC_PAYLINKS_API_BASE must be set for the onion build; deploy-onion.sh exports it.",
  );
}
