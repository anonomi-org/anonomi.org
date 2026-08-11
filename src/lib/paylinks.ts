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
 * Which network this build is for comes from `site.ts`, which derives it from
 * `PUBLIC_SITE_BASE_URL` — no additional build flag to keep in sync, and
 * anything unrecognised is treated as clearnet so it fails closed.
 */

import { IS_LOCAL_BUILD, IS_ONION_BUILD } from "./site";

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
