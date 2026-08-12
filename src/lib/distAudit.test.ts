import test from "node:test";
import assert from "node:assert/strict";

import {
  auditBuildLevel,
  auditCss,
  auditHtml,
  auditScript,
  auditXml,
  hasOnionLocation,
  hasSafeReferrerPolicy,
  parseAttrs,
  remoteHost,
  RULES,
  srcsetUrls,
  type AuditOptions,
  type Finding,
  type RuleId,
} from "./distAudit.ts";

const ONION = "dwbgp2zfjqxcrk6fk3j7tr5uyqes4lxkipnsvm6atyi5eo7smsa6ykqd.onion";
const REPO_ONION = "http://ll7nb2gloylmzcnb4q6apax6zt4c5gbdvx73cvf7fj4frep7zsgdeoqd.onion/anonomi";

function options(network: "onion" | "clearnet"): AuditOptions {
  return {
    network,
    siteHost: network === "onion" ? ONION : "anonomi.org",
    allowedHosts: {
      "github.com": { reason: "test", onion: REPO_ONION },
      "www.eff.org": { reason: "test", onion: "" },
      "anonomi.org": { reason: "test", onion: `http://${ONION}` },
      [ONION]: { reason: "test" },
    },
    allowedScriptHosts: { "tile.openstreetmap.org": "test" },
  };
}

const rules = (findings: Finding[]): RuleId[] => findings.map((f) => f.rule);

// --- URLs -------------------------------------------------------------------

test("remoteHost ignores anything that stays on the page's own origin", () => {
  const host = "anonomi.org";
  assert.equal(remoteHost("/_astro/app.js", host), "");
  assert.equal(remoteHost("#section", host), "");
  assert.equal(remoteHost("data:image/png;base64,AAAA", host), "");
  assert.equal(remoteHost("mailto:hello@anonomi.org", host), "");
  assert.equal(remoteHost("https://anonomi.org/docs/", host), "");
  assert.equal(remoteHost("", host), "");
});

test("remoteHost catches protocol-relative URLs, which URL alone cannot parse", () => {
  assert.equal(remoteHost("//cdn.example.com/a.js", "anonomi.org"), "cdn.example.com");
});

test("remoteHost reports the host of anything that leaves", () => {
  assert.equal(remoteHost("https://GitHub.com/x", "anonomi.org"), "github.com");
  assert.equal(remoteHost(" https://fonts.googleapis.com/css ", "anonomi.org"), "fonts.googleapis.com");
});

test("srcsetUrls takes the URL out of each candidate", () => {
  assert.deepEqual(srcsetUrls("a.png 1x, https://cdn.example.com/b.png 2x"), [
    "a.png",
    "https://cdn.example.com/b.png",
  ]);
});

// --- markup -----------------------------------------------------------------

test("parseAttrs reads every quoting style and lowercases the names", () => {
  const attrs = parseAttrs(` SRC="a.js" rel='stylesheet' async data-x=1`);
  assert.equal(attrs.src, "a.js");
  assert.equal(attrs.rel, "stylesheet");
  assert.equal(attrs["data-x"], "1");
});

// --- remote subresources ----------------------------------------------------

test("a subresource pointing off-origin fails, on either network", () => {
  for (const network of ["onion", "clearnet"] as const) {
    const html = `<script src="https://cdn.example.com/a.js"></script>`;
    const found = auditHtml("p.html", html, options(network));
    assert.deepEqual(rules(found), ["remote-subresource"]);
  }
});

test("local subresources are left alone", () => {
  const html = `
    <script src="/_astro/app.js"></script>
    <img src="/logo.png" srcset="/a.png 1x, /b.png 2x">
    <link rel="stylesheet" href="/_astro/index.css">`;
  assert.deepEqual(auditHtml("p.html", html, options("clearnet")), []);
});

test("the fetching forms of <link> are checked and the descriptive ones are not", () => {
  const opts = options("clearnet");
  const fetching = `<link rel="preconnect" href="https://fonts.gstatic.com">`;
  assert.deepEqual(rules(auditHtml("p.html", fetching, opts)), ["remote-subresource"]);

  // rel="me" describes the author; the browser never requests it.
  const descriptive = `<link rel="me" href="https://github.com/anonomi-org">`;
  assert.deepEqual(auditHtml("p.html", descriptive, opts), []);
});

test("a remote font or image in a stylesheet fails", () => {
  const opts = options("clearnet");
  const css = `@import url("https://fonts.googleapis.com/css");
    @font-face { src: url(https://fonts.gstatic.com/f.woff2); }
    body { background: url(/local.png); }`;
  assert.deepEqual(rules(auditCss("a.css", css, opts)), [
    "remote-style-url",
    "remote-style-url",
  ]);
});

test("inline styles are read like a stylesheet", () => {
  const html = `<style>body{background:url(https://cdn.example.com/bg.png)}</style>`;
  assert.deepEqual(rules(auditHtml("p.html", html, options("clearnet"))), ["remote-style-url"]);
});

// --- metadata ---------------------------------------------------------------

test("the onion build may not name the clearnet site as canonical", () => {
  const html = `
    <link rel="canonical" href="https://anonomi.org/docs/">
    <link rel="alternate" hreflang="pt" href="https://anonomi.org/pt/docs/">
    <meta property="og:url" content="https://anonomi.org/docs/">`;
  assert.deepEqual(rules(auditHtml("p.html", html, options("onion"))), [
    "clearnet-metadata",
    "clearnet-metadata",
    "clearnet-metadata",
  ]);
});

test("the same metadata is correct on the clearnet build", () => {
  const html = `<link rel="canonical" href="https://anonomi.org/docs/">`;
  assert.deepEqual(auditHtml("p.html", html, options("clearnet")), []);
});

test("onion metadata on the onion build is fine", () => {
  const html = `<link rel="canonical" href="http://${ONION}/docs/">`;
  assert.deepEqual(auditHtml("p.html", html, options("onion")), []);
});

test("a sitemap of clearnet URLs is only a problem on the onion", () => {
  const xml = `<url><loc>https://anonomi.org/</loc></url>`;
  assert.deepEqual(rules(auditXml("sitemap-0.xml", xml, options("onion"))), ["clearnet-metadata"]);
  assert.deepEqual(auditXml("sitemap-0.xml", xml, options("clearnet")), []);
});

// --- links ------------------------------------------------------------------

test("a link to an unlisted host fails", () => {
  const html = `<a href="https://tracker.example.com/x" rel="noreferrer">x</a>`;
  assert.deepEqual(rules(auditHtml("p.html", html, options("clearnet"))), ["unlisted-link-host"]);
});

test("a listed host with noreferrer passes", () => {
  const html = `<a href="https://www.eff.org/" rel="noreferrer noopener">EFF</a>`;
  assert.deepEqual(auditHtml("p.html", html, options("clearnet")), []);
});

test("an outbound link without noreferrer is reported", () => {
  const html = `<a href="https://www.eff.org/">EFF</a>`;
  assert.deepEqual(rules(auditHtml("p.html", html, options("clearnet"))), ["missing-noreferrer"]);
});

test("a page-wide referrer policy covers links that carry no rel of their own", () => {
  const html = `<meta name="referrer" content="no-referrer"><a href="https://www.eff.org/">EFF</a>`;
  assert.deepEqual(auditHtml("p.html", html, options("clearnet")), []);
});

test("a per-link referrerpolicy attribute counts too", () => {
  const html = `<a href="https://www.eff.org/" referrerpolicy="no-referrer">EFF</a>`;
  assert.deepEqual(auditHtml("p.html", html, options("clearnet")), []);
});

test("a policy that still sends the origin does not count", () => {
  const opts = options("clearnet");
  for (const policy of ["strict-origin-when-cross-origin", "origin", "unsafe-url"]) {
    const html = `<meta name="referrer" content="${policy}"><a href="https://www.eff.org/">EFF</a>`;
    assert.deepEqual(rules(auditHtml("p.html", html, opts)), ["missing-noreferrer"], policy);
  }
});

test("a fallback list is only safe when every value in it is", () => {
  // The last value the browser understands wins, so one weak entry decides it.
  assert.equal(hasSafeReferrerPolicy(`<meta name="referrer" content="no-referrer, same-origin">`), true);
  assert.equal(hasSafeReferrerPolicy(`<meta name="referrer" content="no-referrer, origin">`), false);
  assert.equal(hasSafeReferrerPolicy(`<meta name="referrer" content="">`), false);
  assert.equal(hasSafeReferrerPolicy(`<meta name="description" content="no-referrer">`), false);
});

test("the onion build is told when a link has an onion equivalent", () => {
  const html = `<a href="https://github.com/anonomi-org" rel="noreferrer">Code</a>`;
  assert.deepEqual(rules(auditHtml("p.html", html, options("onion"))), ["missing-onion-link"]);
});

test("a link that prints its own address is listing it, not sending you there", () => {
  // The onion services page lists both addresses on purpose.
  const html = `<a href="https://anonomi.org" rel="noreferrer">https://anonomi.org</a>`;
  assert.deepEqual(auditHtml("p.html", html, options("onion")), []);
});

test("links between onions need no referrer policy", () => {
  const html = `<a href="http://${ONION}/paylinks">Paylinks</a>`;
  assert.deepEqual(auditHtml("p.html", html, options("onion")), []);
});

// --- scripts ----------------------------------------------------------------

test("a bundled script naming an unlisted host is reported once", () => {
  const js = `fetch("https://evil.example.com/a");fetch("https://evil.example.com/b")`;
  assert.deepEqual(rules(auditScript("app.js", js, options("clearnet"))), [
    "unlisted-script-host",
  ]);
});

test("a tile template's {s} placeholder resolves to the real host", () => {
  const js = `const u="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"`;
  assert.deepEqual(auditScript("app.js", js, options("clearnet")), []);
});

test("a host assembled by interpolation is skipped rather than guessed at", () => {
  const js = "const u=`https://example.com${path}/x`";
  assert.deepEqual(auditScript("app.js", js, options("clearnet")), []);
});

test("an allow list lookup cannot be satisfied by Object.prototype", () => {
  // "constructor" is a legal hostname, and a plain object lookup finds one.
  const html = `<a href="https://constructor/x" rel="noreferrer">x</a>`;
  assert.deepEqual(rules(auditHtml("p.html", html, options("clearnet"))), ["unlisted-link-host"]);
  assert.deepEqual(rules(auditScript("app.js", `fetch("https://toString/x")`, options("clearnet"))), [
    "unlisted-script-host",
  ]);
});

// --- development leftovers --------------------------------------------------

test("a localhost address in a deploy build fails, whatever the file", () => {
  const opts = options("onion");
  assert.deepEqual(rules(auditHtml("p.html", `<p>http://localhost:8787</p>`, opts)), [
    "dev-origin",
  ]);
  assert.deepEqual(rules(auditScript("app.js", `fetch("http://127.0.0.1:8787")`, opts)), [
    "dev-origin",
  ]);
  assert.deepEqual(rules(auditHtml("p.html", `<p>localhost:4321</p>`, opts)), ["dev-origin"]);
});

test("prose that merely says localhost does not block a deploy", () => {
  const opts = options("onion");
  assert.deepEqual(auditHtml("p.html", `<p>Open the dev server on localhost.</p>`, opts), []);
});

// --- whole build ------------------------------------------------------------

test("hasOnionLocation only counts a meta tag pointing at an onion", () => {
  assert.equal(hasOnionLocation(`<meta http-equiv="onion-location" content="http://${ONION}">`), true);
  assert.equal(hasOnionLocation(`<meta http-equiv="onion-location" content="https://anonomi.org">`), false);
  assert.equal(hasOnionLocation(`<meta name="description" content="x">`), false);
});

/** Create pages for two locales, each in the given state. */
function paylinks(state: { hasForm: boolean; hasNotice: boolean }) {
  return ["paylinks/create/index.html", "pt/paylinks/create/index.html"].map((file) => ({
    file,
    ...state,
  }));
}

const FORMS = paylinks({ hasForm: true, hasNotice: false });
const NOTICES = paylinks({ hasForm: false, hasNotice: true });

test("clearnet pages that do not advertise the onion are reported", () => {
  const facts = { htmlPages: 10, pagesWithOnionLocation: 4, paylinks: NOTICES };
  assert.deepEqual(rules(auditBuildLevel(facts, options("clearnet"))), ["onion-location"]);

  const complete = { htmlPages: 10, pagesWithOnionLocation: 10, paylinks: NOTICES };
  assert.deepEqual(auditBuildLevel(complete, options("clearnet")), []);
});

test("the onion build must not carry a tag Tor Browser ignores there", () => {
  const facts = { htmlPages: 10, pagesWithOnionLocation: 10, paylinks: FORMS };
  assert.deepEqual(rules(auditBuildLevel(facts, options("onion"))), ["onion-location"]);
});

test("Paylinks forms belong to the onion build and the notice to the clearnet one", () => {
  const onForm = { htmlPages: 1, pagesWithOnionLocation: 0, paylinks: FORMS };
  const onNotice = { htmlPages: 1, pagesWithOnionLocation: 1, paylinks: NOTICES };

  assert.equal(rules(auditBuildLevel(onForm, options("onion"))).includes("paylinks-gating"), false);
  assert.equal(
    rules(auditBuildLevel(onNotice, options("clearnet"))).includes("paylinks-gating"),
    false,
  );

  assert.equal(
    rules(auditBuildLevel(onForm, options("clearnet"))).includes("paylinks-gating"),
    true,
  );
  assert.equal(rules(auditBuildLevel(onNotice, options("onion"))).includes("paylinks-gating"), true);
});

test("every locale is checked, not just the first page that passes", () => {
  // One good page must not vouch for the rest.
  const mixed = {
    htmlPages: 2,
    pagesWithOnionLocation: 2,
    paylinks: [
      { file: "paylinks/create/index.html", hasForm: false, hasNotice: true },
      { file: "pt/paylinks/create/index.html", hasForm: true, hasNotice: false },
    ],
  };
  const found = auditBuildLevel(mixed, options("clearnet")).filter(
    (f) => f.rule === "paylinks-gating",
  );
  assert.equal(found.length, 1);
  assert.equal(found[0]!.file, "pt/paylinks/create/index.html");
});

test("a form on any Paylinks route is caught, not only the create page", () => {
  const facts = {
    htmlPages: 2,
    pagesWithOnionLocation: 2,
    paylinks: [
      ...NOTICES,
      { file: "es/paylinks/delete/index.html", hasForm: true, hasNotice: false },
    ],
  };
  const found = auditBuildLevel(facts, options("clearnet")).filter(
    (f) => f.rule === "paylinks-gating",
  );
  assert.deepEqual(
    found.map((f) => f.file),
    ["es/paylinks/delete/index.html"],
  );
});

test("finding no Paylinks page to check is a failure, not a pass", () => {
  const facts = { htmlPages: 10, pagesWithOnionLocation: 0, paylinks: [] };
  assert.deepEqual(rules(auditBuildLevel(facts, options("onion"))), ["paylinks-gating"]);
});

test("a clearnet form is reported once, not alongside a contradiction", () => {
  const facts = { htmlPages: 1, pagesWithOnionLocation: 1, paylinks: FORMS };
  const details = auditBuildLevel(facts, options("clearnet"))
    .filter((f) => f.rule === "paylinks-gating")
    .map((f) => f.detail);
  assert.deepEqual(details, ["form on clearnet", "form on clearnet"]);
});

// --- severities -------------------------------------------------------------

test("every rule has a summary to print", () => {
  for (const [rule, spec] of Object.entries(RULES)) {
    assert.ok(spec.summary, `${rule} has no summary`);
  }
});

test("the rules the build already keeps are the ones that block a deploy", () => {
  const blocking: RuleId[] = [
    "remote-subresource",
    "remote-style-url",
    "dev-origin",
    "unlisted-link-host",
    "paylinks-gating",
    "onion-location",
    "missing-noreferrer",
    "clearnet-metadata",
  ];
  for (const rule of blocking) {
    assert.equal(RULES[rule].severity, "fail", `${rule} should block a deploy`);
  }
});
