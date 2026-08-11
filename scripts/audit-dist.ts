/**
 * Deploy gate: check the built site before it is published.
 *
 * Run after `astro build` with the same PUBLIC_SITE_BASE_URL, so the rules
 * match the network the output is going to:
 *
 *   PUBLIC_SITE_BASE_URL=https://anonomi.org node scripts/audit-dist.ts dist
 *
 * Rules live in src/lib/distAudit.ts. `--strict` treats warnings as failures.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { hostnameOf, networkOf } from "../src/lib/site.ts";
import { ALLOWED_HOSTS, ALLOWED_SCRIPT_HOSTS } from "../src/lib/allowedHosts.ts";
import {
  auditBuildLevel,
  auditCss,
  auditHtml,
  auditScript,
  auditXml,
  hasOnionLocation,
  isPaylinksPage,
  RULES,
  severityOf,
  type AuditOptions,
  type BuildFacts,
  type Finding,
  type RuleId,
} from "../src/lib/distAudit.ts";

const EXAMPLES_PER_RULE = 5;

/** Text formats worth reading. Anything else in dist is an image or an index. */
const SCANNED = new Set([
  ".html",
  ".css",
  ".js",
  ".mjs",
  ".xml",
  ".txt",
  ".json",
  ".webmanifest",
  ".svg",
]);

function main(): void {
  const args = process.argv.slice(2);
  const strict = args.includes("--strict");
  const dir = args.find((arg) => !arg.startsWith("--")) ?? "dist";

  // The network comes from the same variable the build read, so the two
  // cannot disagree about which site this is.
  const siteBase = process.env.PUBLIC_SITE_BASE_URL ?? "";
  if (!siteBase) fatal("PUBLIC_SITE_BASE_URL is unset; the audit needs it to pick the rules.");

  const network = networkOf(siteBase);
  if (network === "local") {
    fatal(`PUBLIC_SITE_BASE_URL is ${siteBase}; set it to the address being deployed to.`);
  }

  const opts: AuditOptions = {
    network,
    siteHost: hostnameOf(siteBase),
    allowedHosts: ALLOWED_HOSTS,
    allowedScriptHosts: ALLOWED_SCRIPT_HOSTS,
  };

  console.log(`Auditing ${dir} as the ${network} build (${siteBase})`);

  const findings: Finding[] = [];
  const facts: BuildFacts = { htmlPages: 0, pagesWithOnionLocation: 0, paylinks: [] };

  for (const file of walk(dir)) {
    const ext = file.slice(file.lastIndexOf("."));
    if (!SCANNED.has(ext)) continue;

    const rel = relative(dir, file).split(sep).join("/");
    const text = readFileSync(file, "utf8");

    if (ext === ".html") {
      facts.htmlPages += 1;
      if (hasOnionLocation(text)) facts.pagesWithOnionLocation += 1;
      if (isPaylinksPage(rel)) {
        facts.paylinks.push({
          file: rel,
          hasForm: /<form\b/i.test(text),
          hasNotice: text.includes("paylinks-onion-only-heading"),
        });
      }
      findings.push(...auditHtml(rel, text, opts));
    } else if (ext === ".svg") {
      findings.push(...auditHtml(rel, text, opts));
    } else if (ext === ".css") {
      findings.push(...auditCss(rel, text, opts));
    } else if (ext === ".js" || ext === ".mjs") {
      findings.push(...auditScript(rel, text, opts));
    } else {
      findings.push(...auditXml(rel, text, opts));
    }
  }

  findings.push(...auditBuildLevel(facts, opts));

  process.exit(report(findings, facts, strict) ? 0 : 1);
}

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      yield* walk(path);
    } else {
      yield path;
    }
  }
}

/** Print the findings grouped by rule. Returns whether the build passes. */
function report(findings: Finding[], facts: BuildFacts, strict: boolean): boolean {
  const byRule = new Map<RuleId, Finding[]>();
  for (const finding of findings) {
    const list = byRule.get(finding.rule) ?? [];
    list.push(finding);
    byRule.set(finding.rule, list);
  }

  const order: RuleId[] = (Object.keys(RULES) as RuleId[]).filter((rule) => byRule.has(rule));
  order.sort((a, b) => Number(severityOf(b) === "fail") - Number(severityOf(a) === "fail"));

  let failed = 0;
  let warned = 0;

  for (const rule of order) {
    const hits = byRule.get(rule)!;
    const severity = strict ? "fail" : severityOf(rule);
    if (severity === "fail") failed += hits.length;
    else warned += hits.length;

    const label = severity === "fail" ? "FAIL" : "warn";
    console.log(`\n${label}  ${rule} — ${RULES[rule].summary} (${hits.length})`);

    // Failures always show where. Warnings only do when there are few, so a
    // new one is readable instead of buried under a known bulk count.
    if (severity !== "fail" && hits.length > EXAMPLES_PER_RULE) continue;

    for (const finding of hits.slice(0, EXAMPLES_PER_RULE)) {
      console.log(`      ${finding.file}: ${finding.detail}`);
    }
    if (hits.length > EXAMPLES_PER_RULE) {
      console.log(`      … and ${hits.length - EXAMPLES_PER_RULE} more`);
    }
  }

  console.log(
    `\n${facts.htmlPages} pages scanned — ${failed} failing, ${warned} warning` +
      (strict ? " (--strict: warnings count as failures)" : ""),
  );

  if (failed === 0) console.log("Build passes the deploy gate.");
  return failed === 0;
}

function fatal(message: string): never {
  console.error(`audit-dist: ${message}`);
  process.exit(2);
}

main();
