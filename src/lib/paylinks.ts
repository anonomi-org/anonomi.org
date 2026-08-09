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

/**
 * True only for builds whose origin can actually reach the Paylinks API:
 * the onion site, or a local development server.
 */
export const PAYLINKS_ENABLED =
  host.endsWith(".onion") || host === "localhost" || host === "127.0.0.1";
