import test from "node:test";
import assert from "node:assert/strict";

import {
  DETAIL_FIELDS,
  InsecureContextError,
  MAX_INDEX_SPAN,
  buildEmbedHtml,
  computeOwnerKey,
  escapeAttr,
  escapeHtml,
  firstDetailMessage,
  firstString,
  hasSubtleCrypto,
  isMoneroUri,
  isValidPaylinkId,
  isViewKeyShape,
  ownerKeyInput,
  sha256Hex,
  toIntOrUndef,
  validateIndexRange,
  wipeInput,
} from "./paylinksClient.ts";

// --- escaping ---------------------------------------------------------------

test("escapeHtml escapes every character that can break out of markup", () => {
  assert.equal(escapeHtml("&"), "&amp;");
  assert.equal(escapeHtml("<"), "&lt;");
  assert.equal(escapeHtml(">"), "&gt;");
  assert.equal(escapeHtml('"'), "&quot;");
  assert.equal(escapeHtml("'"), "&#039;");
});

test("escapeHtml escapes the ampersand first, so nothing is double-escaped", () => {
  // A naive order turns "<" into "&lt;" and then the "&" of that into
  // "&amp;lt;", which renders as literal "&lt;" instead of "<".
  assert.equal(escapeHtml("<script>"), "&lt;script&gt;");
  assert.equal(escapeHtml("&lt;"), "&amp;lt;");
});

test("escapeHtml defuses a script tag and an attribute breakout", () => {
  assert.equal(
    escapeHtml('<script>alert(1)</script>'),
    "&lt;script&gt;alert(1)&lt;/script&gt;",
  );
  assert.equal(
    escapeHtml('" onerror="alert(1)'),
    "&quot; onerror=&quot;alert(1)",
  );
  assert.equal(
    escapeHtml("' onmouseover='alert(1)"),
    "&#039; onmouseover=&#039;alert(1)",
  );
});

test("escapeHtml turns nullish into an empty string, not a literal", () => {
  assert.equal(escapeHtml(null), "");
  assert.equal(escapeHtml(undefined), "");
});

test("escapeHtml keeps a zero rather than swallowing it", () => {
  // `String(s || "")` would drop this; the module uses `??` for that reason.
  assert.equal(escapeHtml(0), "0");
});

test("escapeAttr leaves the apostrophe alone but blocks the rest", () => {
  // The embed snippet only ever interpolates into double-quoted attributes,
  // and this output is copied out by users, so it stays byte-compatible.
  assert.equal(escapeAttr("'"), "'");
  assert.equal(escapeAttr("&"), "&amp;");
  assert.equal(escapeAttr('"'), "&quot;");
  assert.equal(escapeAttr("<"), "&lt;");
  assert.equal(escapeAttr(">"), "&gt;");
  assert.equal(escapeAttr(null), "");
});

// --- identifier and shape validation ---------------------------------------

test("isValidPaylinkId accepts a UUID in either case", () => {
  assert.equal(isValidPaylinkId("2f4c1a0e-1b2c-3d4e-5f60-718293a4b5c6"), true);
  assert.equal(isValidPaylinkId("2F4C1A0E-1B2C-3D4E-5F60-718293A4B5C6"), true);
});

test("isValidPaylinkId rejects anything that is not a UUID", () => {
  for (const bad of [
    "",
    "not-a-uuid",
    "2f4c1a0e-1b2c-3d4e-5f60-718293a4b5c",
    "2f4c1a0e-1b2c-3d4e-5f60-718293a4b5c67",
    "2f4c1a0e1b2c3d4e5f60718293a4b5c6",
    "../../etc/passwd",
    "2f4c1a0e-1b2c-3d4e-5f60-718293a4b5c6/../admin",
    null,
    undefined,
    42,
  ]) {
    assert.equal(isValidPaylinkId(bad as unknown), false, `accepted ${bad}`);
  }
});

test("isValidPaylinkId is not fooled by a newline after a valid id", () => {
  // An unanchored or multiline regex would let this through and put an
  // attacker-chosen suffix into the request path.
  assert.equal(
    isValidPaylinkId("2f4c1a0e-1b2c-3d4e-5f60-718293a4b5c6\nevil"),
    false,
  );
});

test("isViewKeyShape wants exactly 64 hex characters", () => {
  assert.equal(isViewKeyShape("a".repeat(64)), true);
  assert.equal(isViewKeyShape("A".repeat(64)), true);
  assert.equal(isViewKeyShape("0123456789abcdef".repeat(4)), true);

  assert.equal(isViewKeyShape("a".repeat(63)), false);
  assert.equal(isViewKeyShape("a".repeat(65)), false);
  assert.equal(isViewKeyShape("g".repeat(64)), false);
  assert.equal(isViewKeyShape(""), false);
  assert.equal(isViewKeyShape(null as unknown), false);
});

// --- URI safety -------------------------------------------------------------

test("isMoneroUri accepts a monero URI regardless of case", () => {
  assert.equal(isMoneroUri("monero:4AdUnd..."), true);
  assert.equal(isMoneroUri("MONERO:4AdUnd..."), true);
  assert.equal(isMoneroUri("Monero:4AdUnd...?tx_amount=1"), true);
});

test("isMoneroUri rejects a scheme that could execute", () => {
  // This is the check standing between a spoofed API response and a
  // javascript: link rendered in front of a donor.
  for (const bad of [
    "javascript:alert(1)",
    "JavaScript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "vbscript:msgbox(1)",
    "https://example.com",
    "xmonero:abc",
    " monero:abc",
    "",
    null,
    undefined,
  ]) {
    assert.equal(isMoneroUri(bad as unknown), false, `accepted ${bad}`);
  }
});

// --- API error shapes -------------------------------------------------------

test("firstString finds the first non-empty string in a nested value", () => {
  assert.equal(firstString("hello"), "hello");
  assert.equal(firstString(["", "  ", "found"]), "found");
  assert.equal(firstString({ a: { b: ["deep"] } }), "deep");
  assert.equal(firstString("  padded  "), "padded");
});

test("firstString returns null when there is nothing to show", () => {
  assert.equal(firstString(null), null);
  assert.equal(firstString(""), null);
  assert.equal(firstString("   "), null);
  assert.equal(firstString([]), null);
  assert.equal(firstString({}), null);
  assert.equal(firstString(42), null);
});

test("firstDetailMessage reads the base-schema shape", () => {
  assert.equal(
    firstDetailMessage({
      fieldErrors: { privateViewKey: ["privateViewKey must be 64 hex chars"] },
    }),
    "privateViewKey must be 64 hex chars",
  );
});

test("firstDetailMessage reads the semantic shape", () => {
  assert.equal(
    firstDetailMessage({
      publicAddress: ["Not a valid Monero mainnet address"],
    }),
    "Not a valid Monero mainnet address",
  );
});

test("firstDetailMessage reads the options-refinement shape", () => {
  assert.equal(
    firstDetailMessage({
      options: { maxIndex: ["may span at most 1000 addresses"] },
    }),
    "may span at most 1000 addresses",
  );
});

test("firstDetailMessage falls back to form-level errors", () => {
  assert.equal(
    firstDetailMessage({ formErrors: ["something was wrong"] }),
    "something was wrong",
  );
});

test("firstDetailMessage prefers the named fields over anything else", () => {
  const msg = firstDetailMessage({
    somethingElse: ["ignored"],
    publicAddress: ["the real problem"],
  });
  assert.equal(msg, "the real problem");
});

test("firstDetailMessage returns null for a body with no message", () => {
  assert.equal(firstDetailMessage(null), null);
  assert.equal(firstDetailMessage(undefined), null);
  assert.equal(firstDetailMessage("nope"), null);
  assert.equal(firstDetailMessage({}), null);
});

test("DETAIL_FIELDS is ordered so the likeliest mistake is reported first", () => {
  assert.deepEqual(
    [...DETAIL_FIELDS],
    ["publicAddress", "privateViewKey", "options", "label", "amount"],
  );
});

// --- numeric input ----------------------------------------------------------

test("toIntOrUndef accepts positive integers and truncates", () => {
  assert.equal(toIntOrUndef("5"), 5);
  assert.equal(toIntOrUndef(" 7 "), 7);
  assert.equal(toIntOrUndef("3.9"), 3);
  assert.equal(toIntOrUndef(12), 12);
});

test("toIntOrUndef rejects blank, zero, negative and unparseable input", () => {
  assert.equal(toIntOrUndef(""), undefined);
  assert.equal(toIntOrUndef("   "), undefined);
  assert.equal(toIntOrUndef("0"), undefined);
  assert.equal(toIntOrUndef("-4"), undefined);
  assert.equal(toIntOrUndef("abc"), undefined);
  assert.equal(toIntOrUndef(null), undefined);
  assert.equal(toIntOrUndef(undefined), undefined);
  assert.equal(toIntOrUndef(Infinity), undefined);
  assert.equal(toIntOrUndef(NaN), undefined);
});

// --- index range ------------------------------------------------------------

test("validateIndexRange passes when either bound is absent", () => {
  assert.equal(validateIndexRange(undefined, undefined), null);
  assert.equal(validateIndexRange(1, undefined), null);
  assert.equal(validateIndexRange(undefined, 100), null);
});

test("validateIndexRange rejects an inverted range", () => {
  assert.equal(validateIndexRange(10, 5), "minMax");
});

test("validateIndexRange limits the width, not the size, of the indices", () => {
  // High indices are fine; a wide span is not. This mirrors the API, which
  // derives every address in the range up front.
  assert.equal(validateIndexRange(999_000, 999_999), null);
  assert.equal(validateIndexRange(1, 5000), "span");
});

test("validateIndexRange allows exactly the maximum span and no more", () => {
  assert.equal(validateIndexRange(1, MAX_INDEX_SPAN), null);
  assert.equal(validateIndexRange(1, MAX_INDEX_SPAN + 1), "span");
});

test("validateIndexRange accepts a single-address range", () => {
  assert.equal(validateIndexRange(7, 7), null);
});

// --- embed snippet ----------------------------------------------------------

const STYLES = ["pillSolid", "pillOutline", "icon", "badge", "link"] as const;

test("every embed style produces a link to the donate URL", () => {
  for (const style of STYLES) {
    const html = buildEmbedHtml("http://example.onion/paylinks/d#abc", style);
    assert.match(html, /^<!-- Anonomi Paylinks -->\n/, `${style} lost its marker`);
    assert.ok(
      html.includes('href="http://example.onion/paylinks/d#abc"'),
      `${style} lost the donate URL`,
    );
    assert.ok(html.includes("</a>"), `${style} is not a link`);
  }
});

test("an unknown embed style falls back to the plain link", () => {
  assert.equal(
    buildEmbedHtml("http://x.onion/d#1", "nonsense"),
    buildEmbedHtml("http://x.onion/d#1", "link"),
  );
});

test("no embed style emits script or an event handler", () => {
  // Users paste this into their own sites, so it has to stay inert.
  for (const style of STYLES) {
    const html = buildEmbedHtml("http://example.onion/paylinks/d#abc", style);
    assert.ok(!/<script/i.test(html), `${style} emitted a script tag`);
    assert.ok(!/\son\w+\s*=/i.test(html), `${style} emitted an event handler`);
    assert.ok(!/javascript:/i.test(html), `${style} emitted a javascript URI`);
  }
});

test("a hostile donate URL cannot break out of the embed href", () => {
  const html = buildEmbedHtml(
    'http://x.onion/d#1" onmouseover="alert(1)',
    "link",
  );

  // The payload has to stay inside the attribute value. Checking for the
  // absence of "onmouseover" would not show that: the escaped text still
  // contains those characters, harmlessly. What matters is that the quote
  // was neutralised, so the href ends where the snippet says it ends.
  const href = html.match(/href="([^"]*)"/);
  assert.ok(href, "no href attribute was produced");
  assert.equal(
    href[1],
    "http://x.onion/d#1&quot; onmouseover=&quot;alert(1)",
    "the payload escaped the attribute value",
  );
});

test("every embed style keeps rel=nofollow noopener on the outbound link", () => {
  for (const style of STYLES) {
    const html = buildEmbedHtml("http://example.onion/d#abc", style);
    assert.ok(
      html.includes('rel="nofollow noopener"'),
      `${style} dropped its rel attributes`,
    );
  }
});

// --- owner key --------------------------------------------------------------

test("ownerKeyInput matches the format the API hashes", () => {
  // A wire contract with paylinks-api. Changing this string orphans every
  // paylink that already exists, so it is pinned here on purpose.
  assert.equal(ownerKeyInput("ADDR", "VIEWKEY"), "paylinks:ownerkey:v1:ADDR:VIEWKEY");
});

test("sha256Hex matches the published SHA-256 vectors", async () => {
  assert.equal(
    await sha256Hex(""),
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  );
  assert.equal(
    await sha256Hex("abc"),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
});

test("computeOwnerKey is pinned to a known value", async () => {
  // Must stay identical to the value paylinks-api derives for the same pair.
  // The matching assertion lives in the API's test suite.
  const address =
    "4AdUndXHHZ6cfufTMvppY6JwXNouMBzSkbLYfpAV5Usx3skxNgYeYTRj5UzqtReoS44qo9mtmXCqY45DJ852K5Jv2684Rge";
  const viewKey = "0".repeat(63) + "1";

  assert.equal(
    await computeOwnerKey(address, viewKey),
    "c0aeb3e6dcac211c53c560b8b950b815384ab8b61b7ef59be14067e796b8ade8",
  );
});

test("computeOwnerKey is deterministic and separates its two inputs", async () => {
  const a = await computeOwnerKey("addr", "key");
  const b = await computeOwnerKey("addr", "key");
  assert.equal(a, b);

  // Without the separator these two would hash identically.
  const shifted = await computeOwnerKey("add", "rkey");
  assert.notEqual(a, shifted);
});

test("hasSubtleCrypto reports what this context can do", () => {
  assert.equal(hasSubtleCrypto(), true);
});

test("sha256Hex fails loudly when Web Crypto is missing", async () => {
  // Stands in for a browser that does not treat the onion origin as secure.
  const real = globalThis.crypto;
  Object.defineProperty(globalThis, "crypto", {
    value: undefined,
    configurable: true,
  });

  try {
    assert.equal(hasSubtleCrypto(), false);
    await assert.rejects(() => sha256Hex("abc"), InsecureContextError);
  } finally {
    Object.defineProperty(globalThis, "crypto", {
      value: real,
      configurable: true,
    });
  }

  assert.equal(hasSubtleCrypto(), true);
});

// --- secret wiping ----------------------------------------------------------

test("wipeInput clears both the property and the attribute", () => {
  const calls: string[] = [];
  const el = {
    value: "a-private-view-key",
    setAttribute(name: string, v: string) {
      calls.push(`${name}=${v}`);
    },
  };

  wipeInput(el as unknown as HTMLInputElement);

  assert.equal(el.value, "");
  assert.deepEqual(calls, ["value="]);
});

test("wipeInput tolerates a missing element", () => {
  assert.doesNotThrow(() => wipeInput(null));
  assert.doesNotThrow(() => wipeInput(undefined));
});

test("wipeInput does not throw when the node rejects writes", () => {
  const el = {
    set value(_v: string) {
      throw new Error("read-only");
    },
    get value() {
      return "";
    },
    setAttribute() {},
  };

  assert.doesNotThrow(() => wipeInput(el as unknown as HTMLInputElement));
});
