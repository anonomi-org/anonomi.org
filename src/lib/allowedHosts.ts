/**
 * Hosts the built site may link to. scripts/audit-dist.ts fails on any other
 * `<a href>`, so adding a third-party link costs a line of diff to approve.
 *
 * `onion` is the onion equivalent, where one is known. Set it and the onion
 * build is expected to use that address; "" means there is none to use.
 */

import { ONION_REPO_BASE, ONION_SITE_BASE } from "./site.ts";

export type AllowedHost = {
  /** Why the site links there. */
  reason: string;
  /** Onion equivalent, or "" when there is none. */
  onion?: string;
};

/** F-Droid over Tor, as used in the docs. */
export const FDROID_ONION =
  "http://fdroidorg6cooksyluodepej4erfctzk7rrjpjbbr6wx24jh3lqyfwyd.onion";

/** The Paylinks API. Documented, never linked. */
export const PAYLINKS_API_ONION =
  "http://b7o4bzmc5ylx3ynbg4pvxs4vwifviuzkonle66uzdrv5ff7vj5pln7yd.onion";

export const ALLOWED_HOSTS: Record<string, AllowedHost> = {
  // --- ours ---------------------------------------------------------------
  "anonomi.org": {
    reason: "The clearnet site, listed by address on the onion services page.",
    onion: ONION_SITE_BASE,
  },
  [hostOf(ONION_SITE_BASE)]: {
    reason: "The onion site.",
  },
  [hostOf(ONION_REPO_BASE)]: {
    reason: "The onion code mirror.",
  },
  [hostOf(PAYLINKS_API_ONION)]: {
    reason: "The Paylinks API, listed on the privacy page.",
  },

  // --- code and releases --------------------------------------------------
  "github.com": {
    reason: "Code, releases, and the docs edit link. All paths are anonomi-org.",
    onion: ONION_REPO_BASE,
  },
  "codeberg.org": {
    reason: "Source mirror pushed by the deploy workflow.",
    onion: "",
  },
  "f-droid.org": {
    reason: "App distribution.",
    onion: FDROID_ONION,
  },
  [hostOf(FDROID_ONION)]: {
    reason: "F-Droid over Tor.",
  },

  // --- referenced projects and licences ------------------------------------
  "www.torproject.org": {
    reason: "Tor Browser downloads and Tor documentation.",
    onion: "",
  },
  "briarproject.org": { reason: "Prior art referenced in the docs.", onion: "" },
  "code.briarproject.org": { reason: "Briar source, referenced in the docs.", onion: "" },
  "www.eff.org": { reason: "Security and privacy guidance.", onion: "" },
  "www.gnu.org": { reason: "Licence text.", onion: "" },
  "creativecommons.org": { reason: "Licence text.", onion: "" },
  "bsky.app": { reason: "Project account.", onion: "" },
};

/**
 * Hosts a bundled script may name. Kept apart from the link list: naming a
 * host in a library's licence header is not the same as linking to it.
 */
export const ALLOWED_SCRIPT_HOSTS: Record<string, string> = {
  // Requested only after the visitor picks that provider. See the transparency
  // section on /maps and src/lib/tiles.ts.
  "tile.openstreetmap.org": "Maps exporter tile source, opt-in.",
  "tile.opentopomap.org": "Maps exporter tile source, opt-in.",
  "basemaps.cartocdn.com": "Maps exporter tile source, opt-in.",

  // Attribution, licence headers and placeholders inside bundled libraries.
  "www.openstreetmap.org": "Tile attribution text.",
  "carto.com": "Tile attribution text.",
  "leafletjs.com": "Leaflet attribution.",
  "stuartk.com": "Leaflet licence header.",
  "stuk.github.io": "JSZip licence header.",
  "raw.github.com": "JSZip licence header.",
  "markjs.io": "Pagefind dependency licence header.",
  "git.io": "Pagefind dependency licence header.",
  "react.dev": "React error message links.",
  "yekta.dev": "Starlight contributor credit.",
  "harrymkt.github.io": "Starlight contributor credit.",
  "example.com": "Placeholder in the custom tile URL field.",
};

/** Host of a URL we control, so a rotated address updates this list too. */
function hostOf(url: string): string {
  return new URL(url).hostname.toLowerCase();
}
