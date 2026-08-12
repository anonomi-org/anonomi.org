/**
 * Rules the built site has to pass before it is deployed.
 *
 * Not "no clearnet URL in the onion build" — that build carries plenty of
 * legitimate ones, from licence texts to the address directory in the footer.
 * The check is narrower: nothing the browser fetches on its own may leave the
 * origin, and the onion build must not present itself as the clearnet site.
 *
 * Pure functions over file text, so they run under `node --test` like site.ts.
 * The directory walk and the report live in scripts/audit-dist.ts.
 */

import { hostnameOf, type Network } from "./site.ts";
import type { AllowedHost } from "./allowedHosts.ts";

export type Severity = "fail" | "warn";

export type RuleId =
  | "remote-subresource"
  | "remote-style-url"
  | "dev-origin"
  | "clearnet-metadata"
  | "unlisted-link-host"
  | "unlisted-script-host"
  | "missing-onion-link"
  | "missing-noreferrer"
  | "onion-location"
  | "paylinks-gating";

export type Finding = {
  rule: RuleId;
  file: string;
  detail: string;
};

export type AuditOptions = {
  network: Network;
  /** Host this build is served from. Links to it are same-origin, not remote. */
  siteHost: string;
  /** Hosts an `<a href>` may point at. */
  allowedHosts: Record<string, AllowedHost>;
  /** Hosts a bundled script may name. Reason per host, for review. */
  allowedScriptHosts: Record<string, string>;
};

/**
 * What each rule checks, and whether it blocks a deploy.
 *
 * "fail" is for rules the build already keeps; warnings are the rest.
 * `--strict` treats warnings as failures too.
 */
export const RULES: Record<RuleId, { severity: Severity; summary: string }> = {
  "remote-subresource": {
    severity: "fail",
    summary: "Off-origin subresource",
  },
  "remote-style-url": {
    severity: "fail",
    summary: "Off-origin url() or @import in CSS",
  },
  "dev-origin": {
    severity: "fail",
    summary: "localhost address in a deploy build",
  },
  "paylinks-gating": {
    severity: "fail",
    summary: "Paylinks forms on the wrong network",
  },
  "unlisted-link-host": {
    severity: "fail",
    summary: "Link host not in allowedHosts.ts",
  },
  "unlisted-script-host": {
    severity: "warn",
    summary: "Script names a host not in allowedHosts.ts",
  },
  "clearnet-metadata": {
    severity: "warn",
    summary: "Clearnet canonical, og:url or sitemap in the onion build",
  },
  "missing-onion-link": {
    severity: "warn",
    summary: "Link to a host with a known onion address",
  },
  "missing-noreferrer": {
    severity: "warn",
    summary: "Outbound link without rel=noreferrer",
  },
  "onion-location": {
    severity: "fail",
    summary: "onion-location meta tag on the wrong network",
  },
};

export function severityOf(rule: RuleId): Severity {
  return RULES[rule].severity;
}

// --- URLs -------------------------------------------------------------------

/**
 * Host of a URL that would reach a different origin, or "" if it would not.
 *
 * Relative paths, fragments, `data:`, `blob:` and `mailto:` all stay put.
 * Protocol-relative URLs do leave, and `new URL` cannot parse them alone.
 */
export function remoteHost(url: string, siteHost: string): string {
  const trimmed = url.trim();
  if (!trimmed) return "";

  const absolute = trimmed.startsWith("//")
    ? `http:${trimmed}`
    : /^https?:\/\//i.test(trimmed)
      ? trimmed
      : "";
  if (!absolute) return "";

  const host = hostnameOf(absolute);
  if (!host || host === siteHost.toLowerCase()) return "";
  return host;
}

/** First URL of a srcset entry list. Enough to spot an off-origin host. */
export function srcsetUrls(value: string): string[] {
  return value
    .split(",")
    .map((candidate) => candidate.trim().split(/\s+/)[0] ?? "")
    .filter(Boolean);
}

// --- markup -----------------------------------------------------------------

export type Tag = { name: string; attrs: Record<string, string> };

const TAG_RE = /<([a-zA-Z][a-zA-Z0-9:-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
const ATTR_RE = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;

export function parseAttrs(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const match of raw.matchAll(ATTR_RE)) {
    attrs[match[1]!.toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? "";
  }
  return attrs;
}

/** Every tag in a document. Good enough for markup we generate ourselves. */
export function* tags(html: string): Generator<Tag> {
  for (const match of html.matchAll(TAG_RE)) {
    yield { name: match[1]!.toLowerCase(), attrs: parseAttrs(match[2] ?? "") };
  }
}

/** Attributes the browser resolves without being asked, by element. */
const FETCHED_ATTRS: Record<string, string[]> = {
  script: ["src"],
  img: ["src", "srcset"],
  image: ["href", "xlink:href"],
  source: ["src", "srcset"],
  iframe: ["src"],
  frame: ["src"],
  embed: ["src"],
  object: ["data"],
  video: ["src", "poster"],
  audio: ["src"],
  track: ["src"],
  input: ["src"],
  use: ["href", "xlink:href"],
};

/**
 * `rel` values that make <link> fetch something. canonical, alternate, me and
 * license only describe the page, so the metadata rule handles those.
 */
const FETCHING_LINK_RELS = new Set([
  "stylesheet",
  "preconnect",
  "dns-prefetch",
  "preload",
  "prefetch",
  "modulepreload",
  "prerender",
  "icon",
  "shortcut icon",
  "apple-touch-icon",
  "apple-touch-icon-precomposed",
  "mask-icon",
  "manifest",
]);

function linkFetches(rel: string): boolean {
  const value = rel.trim().toLowerCase();
  if (FETCHING_LINK_RELS.has(value)) return true;
  return value.split(/\s+/).some((token) => FETCHING_LINK_RELS.has(token));
}

// --- rules ------------------------------------------------------------------

/** Anchors with their visible text, which the address check below needs. */
const ANCHOR_RE = /<a\b((?:[^>"']|"[^"]*"|'[^']*')*)>([\s\S]*?)<\/a>/gi;

/**
 * A dev address needs a scheme or a port to count. The bare word turns up in
 * prose often enough that matching it would block a deploy over a sentence.
 */
const DEV_HOST = String.raw`(?:localhost|127\.0\.0\.1|0\.0\.0\.0)`;
const DEV_ORIGIN_RE = new RegExp(`(?:https?://${DEV_HOST}(?::\\d+)?|${DEV_HOST}:\\d+)`, "gi");

/** Metadata that tells a crawler which address is the real one. */
const METADATA_ATTRS: Array<{ match: (tag: Tag) => boolean; attr: string; what: string }> = [
  {
    match: (tag) => tag.name === "link" && /\bcanonical\b/i.test(tag.attrs.rel ?? ""),
    attr: "href",
    what: "canonical",
  },
  {
    match: (tag) => tag.name === "link" && /\balternate\b/i.test(tag.attrs.rel ?? ""),
    attr: "href",
    what: "hreflang alternate",
  },
  {
    match: (tag) => tag.name === "meta" && (tag.attrs.property ?? "") === "og:url",
    attr: "content",
    what: "og:url",
  },
];

export function auditHtml(file: string, html: string, opts: AuditOptions): Finding[] {
  const findings: Finding[] = [];
  const onOnion = opts.network === "onion";

  for (const tag of tags(html)) {
    // 1. anything the browser fetches on its own
    const fetched = FETCHED_ATTRS[tag.name] ?? [];
    for (const attr of fetched) {
      const raw = tag.attrs[attr];
      if (!raw) continue;
      const urls = attr === "srcset" ? srcsetUrls(raw) : [raw];
      for (const url of urls) {
        const host = remoteHost(url, opts.siteHost);
        if (host) {
          findings.push({
            rule: "remote-subresource",
            file,
            detail: `<${tag.name} ${attr}> → ${host}`,
          });
        }
      }
    }

    if (tag.name === "link" && linkFetches(tag.attrs.rel ?? "")) {
      const host = remoteHost(tag.attrs.href ?? "", opts.siteHost);
      if (host) {
        findings.push({
          rule: "remote-subresource",
          file,
          detail: `<link rel="${tag.attrs.rel}"> → ${host}`,
        });
      }
    }

    // 2. metadata that claims a different address is canonical
    if (onOnion) {
      for (const meta of METADATA_ATTRS) {
        if (!meta.match(tag)) continue;
        const value = tag.attrs[meta.attr] ?? "";
        const host = remoteHost(value, opts.siteHost);
        if (host && !host.endsWith(".onion")) {
          findings.push({
            rule: "clearnet-metadata",
            file,
            detail: `${meta.what} → ${value}`,
          });
        }
      }
    }
  }

  findings.push(...auditAnchors(file, html, opts));
  findings.push(...auditInlineStyles(file, html, opts));
  findings.push(...auditDevOrigins(file, html));
  return findings;
}

function auditAnchors(file: string, html: string, opts: AuditOptions): Finding[] {
  const findings: Finding[] = [];

  for (const match of html.matchAll(ANCHOR_RE)) {
    const attrs = parseAttrs(match[1] ?? "");
    const href = attrs.href ?? "";
    const host = remoteHost(href, opts.siteHost);
    if (!host) continue;

    // Own properties only: a host called "constructor" or "toString" would
    // otherwise find a match on Object.prototype and skip the check.
    const allowed = Object.hasOwn(opts.allowedHosts, host)
      ? opts.allowedHosts[host]!
      : undefined;
    if (!allowed) {
      findings.push({ rule: "unlisted-link-host", file, detail: `${host} (${href})` });
      continue;
    }

    // A link whose text is its own address is listing that address, not
    // sending anyone there. The onion services page does this on purpose.
    const text = (match[2] ?? "").replace(/<[^>]*>/g, "").trim();
    const documentsItself = text === href || text === href.replace(/\/$/, "");

    if (opts.network === "onion" && allowed.onion && !documentsItself) {
      findings.push({
        rule: "missing-onion-link",
        file,
        detail: `${host} → use ${allowed.onion}`,
      });
    }

    if (!host.endsWith(".onion") && !/\bnoreferrer\b/i.test(attrs.rel ?? "")) {
      findings.push({ rule: "missing-noreferrer", file, detail: `${host} (${href})` });
    }
  }

  return findings;
}

function auditInlineStyles(file: string, html: string, opts: AuditOptions): Finding[] {
  const findings: Finding[] = [];
  for (const match of html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) {
    findings.push(...auditCss(file, match[1] ?? "", opts));
  }
  return findings;
}

const CSS_URL_RE = /url\(\s*['"]?([^'")]+)['"]?\s*\)/gi;
const CSS_IMPORT_RE = /@import\s+(?:url\(\s*)?['"]([^'"]+)['"]/gi;

export function auditCss(file: string, css: string, opts: AuditOptions): Finding[] {
  const findings: Finding[] = [];
  // `@import url(...)` matches both patterns; report it once.
  const seen = new Set<string>();

  for (const re of [CSS_URL_RE, CSS_IMPORT_RE]) {
    for (const match of css.matchAll(re)) {
      const url = match[1] ?? "";
      const host = remoteHost(url, opts.siteHost);
      if (!host || seen.has(url)) continue;
      seen.add(url);
      findings.push({ rule: "remote-style-url", file, detail: `${host} (${url})` });
    }
  }

  findings.push(...auditDevOrigins(file, css));
  return findings;
}

/**
 * Hosts named in a bundled script. A string literal is not a request, so this
 * warns rather than blocks; it is here to make a new remote dependency visible.
 */
export function auditScript(file: string, js: string, opts: AuditOptions): Finding[] {
  const findings: Finding[] = [];
  const seen = new Set<string>();

  for (const match of js.matchAll(/https?:\/\/[^\s"'`<>\\)]+/g)) {
    const host = remoteHost(match[0], opts.siteHost);
    // Tile templates carry a {s} subdomain placeholder; compare the real host.
    const bare = host.replace(/^\{[a-z]\}\./i, "");
    // A host built by interpolation cannot be checked, only guessed at.
    if (!bare || !/^[a-z0-9.-]+$/i.test(bare) || seen.has(bare)) continue;
    seen.add(bare);
    // dev-origin already covers these; say it once.
    if (isDevHost(bare)) continue;
    const listed =
      Object.hasOwn(opts.allowedScriptHosts, bare) || Object.hasOwn(opts.allowedHosts, bare);
    if (!listed && !isSchemaHost(bare)) {
      findings.push({ rule: "unlisted-script-host", file, detail: bare });
    }
  }

  findings.push(...auditDevOrigins(file, js));
  return findings;
}

function isDevHost(host: string): boolean {
  return host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0";
}

/** XML namespace URIs are identifiers, never fetched. */
function isSchemaHost(host: string): boolean {
  return host === "www.w3.org" || host === "www.sitemaps.org" || host === "www.google.com";
}

/** Sitemaps and any other XML that states where the site lives. */
export function auditXml(file: string, xml: string, opts: AuditOptions): Finding[] {
  if (opts.network !== "onion") return auditDevOrigins(file, xml);

  const findings: Finding[] = [];
  const seen = new Set<string>();
  for (const match of xml.matchAll(/<loc>([^<]+)<\/loc>|hreflang="[^"]*"\s+href="([^"]+)"/gi)) {
    const value = match[1] ?? match[2] ?? "";
    const host = remoteHost(value, opts.siteHost);
    if (host && !host.endsWith(".onion") && !seen.has(host)) {
      seen.add(host);
      findings.push({ rule: "clearnet-metadata", file, detail: `sitemap entry → ${value}` });
    }
  }
  findings.push(...auditDevOrigins(file, xml));
  return findings;
}

function auditDevOrigins(file: string, text: string): Finding[] {
  const findings: Finding[] = [];
  const seen = new Set<string>();
  for (const match of text.matchAll(DEV_ORIGIN_RE)) {
    if (seen.has(match[0])) continue;
    seen.add(match[0]);
    findings.push({ rule: "dev-origin", file, detail: match[0] });
  }
  return findings;
}

// --- whole-build rules ------------------------------------------------------

export type PaylinksPage = {
  /** Path within dist, e.g. "pt/paylinks/create/index.html". */
  file: string;
  hasForm: boolean;
  hasNotice: boolean;
};

export type BuildFacts = {
  htmlPages: number;
  pagesWithOnionLocation: number;
  /** Every page under a paylinks route, in every locale. */
  paylinks: PaylinksPage[];
};

/** Any page below a paylinks route, including the localised ones. */
export function isPaylinksPage(file: string): boolean {
  return /(^|\/)paylinks\//.test(file);
}

/** The page carrying the create form, in any locale. */
export function isPaylinksCreatePage(file: string): boolean {
  return /(^|\/)paylinks\/create\/index\.html$/.test(file);
}

export function auditBuildLevel(facts: BuildFacts, opts: AuditOptions): Finding[] {
  const findings: Finding[] = [];
  const onOnion = opts.network === "onion";

  // Tor Browser only honours onion-location on an HTTPS page that is not
  // itself an onion, so the two networks want opposite answers.
  if (onOnion && facts.pagesWithOnionLocation > 0) {
    findings.push({
      rule: "onion-location",
      file: "(build)",
      detail: `${facts.pagesWithOnionLocation} pages carry the tag, which does nothing here`,
    });
  }
  if (!onOnion && facts.pagesWithOnionLocation < facts.htmlPages) {
    findings.push({
      rule: "onion-location",
      file: "(build)",
      detail: `${facts.htmlPages - facts.pagesWithOnionLocation} of ${facts.htmlPages} pages do not carry the tag`,
    });
  }

  // Paylinks runs on the onion only, so clearnet gets the notice and no form.
  // See src/lib/paylinks.ts. Checked across every locale rather than sampled:
  // one page passing says nothing about the other twenty-three.
  const createPages = facts.paylinks.filter((page) => isPaylinksCreatePage(page.file));

  if (createPages.length === 0) {
    // Finding nothing to check is not the same as passing.
    findings.push({
      rule: "paylinks-gating",
      file: "(build)",
      detail: "no Paylinks create page found to check",
    });
  }

  for (const page of createPages) {
    if (onOnion && !page.hasForm) {
      findings.push({ rule: "paylinks-gating", file: page.file, detail: "no form on the onion" });
    }
    if (!onOnion && !page.hasForm && !page.hasNotice) {
      findings.push({ rule: "paylinks-gating", file: page.file, detail: "no form and no notice" });
    }
  }

  if (!onOnion) {
    for (const page of facts.paylinks) {
      if (page.hasForm) {
        findings.push({ rule: "paylinks-gating", file: page.file, detail: "form on clearnet" });
      }
    }
  }

  return findings;
}

/** Does this page advertise the onion to Tor Browser? */
export function hasOnionLocation(html: string): boolean {
  for (const tag of tags(html)) {
    if (tag.name !== "meta") continue;
    if ((tag.attrs["http-equiv"] ?? "").toLowerCase() !== "onion-location") continue;
    if (hostnameOf(tag.attrs.content ?? "").endsWith(".onion")) return true;
  }
  return false;
}
