/**
 * Browser-side helpers shared by the Paylinks pages.
 *
 * These used to be copies inside each page's `<script>`, because a script using
 * `define:vars` is a non-module and can't import. The pages now pass build-time
 * values through `window` and import from here instead, which drops the copies
 * and makes the code that decides what reaches the DOM testable.
 *
 * Don't import `paylinks.ts` or touch `import.meta.env` here — the test runner
 * loads this module directly, outside Astro and Vite.
 */

/** Width of the subaddress index range a single paylink may span. */
export const MAX_INDEX_SPAN = 1000;

/** Escape for HTML text and double-quoted attribute values. */
export function escapeHtml(s: unknown): string {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/**
 * Escape for the embed snippet.
 *
 * Leaves `'` alone and keeps the original replacement order so the HTML users
 * copy out is unchanged. Everything it touches sits in a double-quoted
 * attribute.
 */
export function escapeAttr(s: unknown): string {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

const PAYLINK_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A paylink id is a UUID. Anything else never reaches the API. */
export function isValidPaylinkId(s: unknown): boolean {
  return typeof s === "string" && PAYLINK_ID_RE.test(s);
}

const VIEW_KEY_RE = /^[0-9a-f]{64}$/i;

/** Shape check only — whether the key belongs to the address is the API's call. */
export function isViewKeyShape(s: unknown): boolean {
  return typeof s === "string" && VIEW_KEY_RE.test(s);
}

/**
 * Whether a URI from the API is safe to put in an href. Anything that isn't
 * `monero:` is dropped, so a spoofed API can't land `javascript:` in front of
 * a donor.
 */
export function isMoneroUri(s: unknown): boolean {
  return typeof s === "string" && s.toLowerCase().startsWith("monero:");
}

/** Walked in this order so users see the field they most likely got wrong. */
export const DETAIL_FIELDS = [
  "publicAddress",
  "privateViewKey",
  "options",
  "label",
  "amount",
] as const;

/** First non-empty string anywhere in a nested value. */
export function firstString(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = firstString(item);
      if (found) return found;
    }
    return null;
  }
  if (value && typeof value === "object") {
    for (const key of Object.keys(value as Record<string, unknown>)) {
      const found = firstString((value as Record<string, unknown>)[key]);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Pull a readable message out of an API error body.
 *
 * Validation failures come back in three shapes, depending on which layer
 * rejected the request:
 *
 *   base schema (type/length/enum)  details.fieldErrors.<field>[]
 *                                   details.formErrors[]
 *   semantic (address vs view key)  details.<field>[]
 *   options refinement (span cap)   details.options.<subfield>[]
 *
 * Reading only one is how a real message gets swallowed and shows up as a bare
 * "invalid_request", so this walks whatever arrived.
 */
export function firstDetailMessage(details: unknown): string | null {
  if (!details || typeof details !== "object") return null;
  const d = details as Record<string, unknown>;

  for (const bucket of [d.fieldErrors, d]) {
    if (!bucket || typeof bucket !== "object") continue;
    const b = bucket as Record<string, unknown>;
    for (const field of DETAIL_FIELDS) {
      const found = firstString(b[field]);
      if (found) return found;
    }
  }

  return firstString(d.formErrors) || firstString(d.fieldErrors);
}

/** A positive integer, or undefined for blank and unusable input. */
export function toIntOrUndef(v: unknown): number | undefined {
  const s = String(v ?? "").trim();
  if (!s) return undefined;
  const n = Number(s);
  if (!Number.isFinite(n)) return undefined;
  const i = Math.trunc(n);
  return i > 0 ? i : undefined;
}

/** Why an index range was rejected. The page maps this to a translated string. */
export type IndexRangeError = "minMax" | "span";

/**
 * The API caps how many addresses one paylink can span, since it derives them
 * all up front. It's the width that's capped, not the size of the indices:
 * 999000-999999 is fine, 1-5000 is not. No max attribute can express that, so
 * it's checked here as well as server-side.
 */
export function validateIndexRange(
  minIndex: number | undefined,
  maxIndex: number | undefined,
): IndexRangeError | null {
  if (minIndex === undefined || maxIndex === undefined) return null;
  if (minIndex > maxIndex) return "minMax";
  if (maxIndex - minIndex + 1 > MAX_INDEX_SPAN) return "span";
  return null;
}

export type EmbedStyle =
  | "pillSolid"
  | "pillOutline"
  | "icon"
  | "badge"
  | "link";

/**
 * The snippet a user pastes into their own site. Only an `<a>` with inline
 * styles, never script, so embedding a paylink can't run anything on the host
 * page.
 */
export function buildEmbedHtml(donateUrl: string, style: string): string {
  const href = escapeAttr(donateUrl);

  switch (style) {
    case "pillSolid":
      return (
        `<!-- Anonomi Paylinks -->\n` +
        `<a href="${href}" target="_blank" rel="nofollow noopener"\n` +
        `  style="display:inline-flex;align-items:center;gap:10px;padding:10px 14px;border-radius:999px;` +
        `font:600 14px/1.1 system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,Cantarell,Noto Sans,sans-serif;` +
        `text-decoration:none;background:#ce27e6;color:#0b0b0f;` +
        `box-shadow:0 0 0 1px rgba(255,255,255,.10) inset;">` +
        `Donate XMR</a>\n`
      );

    case "pillOutline":
      return (
        `<!-- Anonomi Paylinks -->\n` +
        `<a href="${href}" target="_blank" rel="nofollow noopener"\n` +
        `  style="display:inline-flex;align-items:center;gap:10px;padding:10px 14px;border-radius:999px;` +
        `font:600 14px/1.1 system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,Cantarell,Noto Sans,sans-serif;` +
        `text-decoration:none;background:transparent;color:#eaeaf0;` +
        `border:1px solid rgba(255,255,255,.18);">` +
        `Donate XMR</a>\n`
      );

    case "icon":
      return (
        `<!-- Anonomi Paylinks -->\n` +
        `<a href="${href}" target="_blank" rel="nofollow noopener"\n` +
        `  style="display:inline-flex;align-items:center;gap:10px;padding:10px 14px;border-radius:12px;` +
        `font:600 14px/1.1 system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,Cantarell,Noto Sans,sans-serif;` +
        `text-decoration:none;background:rgba(255,255,255,.06);color:#eaeaf0;` +
        `border:1px solid rgba(255,255,255,.12);">\n` +
        `  <span style="width:10px;height:10px;border-radius:999px;background:#ce27e6;display:inline-block;"></span>\n` +
        `  Donate XMR\n` +
        `</a>\n`
      );

    case "badge":
      return (
        `<!-- Anonomi Paylinks -->\n` +
        `<a href="${href}" target="_blank" rel="nofollow noopener"\n` +
        `  style="display:inline-block;padding:6px 10px;border-radius:10px;` +
        `font:600 12px/1 system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,Cantarell,Noto Sans,sans-serif;` +
        `text-decoration:none;background:rgba(255,255,255,.06);color:#eaeaf0;` +
        `border:1px solid rgba(255,255,255,.12);letter-spacing:.2px;">` +
        `Donate • XMR</a>\n`
      );

    case "link":
    default:
      return (
        `<!-- Anonomi Paylinks -->\n` +
        `<a href="${href}" rel="nofollow noopener" target="_blank">Donate XMR</a>\n`
      );
  }
}

/**
 * The exact string hashed to produce an owner key.
 *
 * The API derives the same value at creation, so this format is a wire contract
 * — changing it orphans every paylink that already exists.
 */
export function ownerKeyInput(
  publicAddress: string,
  privateViewKey: string,
): string {
  return `paylinks:ownerkey:v1:${publicAddress}:${privateViewKey}`;
}

/**
 * No Web Crypto to hash with.
 *
 * `crypto.subtle` only exists in a secure context. Tor Browser treats onion
 * origins as secure; a stock browser pointed at the same address through a
 * SOCKS proxy doesn't, and there the delete page can't compute an owner key at
 * all. That used to show up as a network error, which sends people off
 * debugging their connection.
 */
export class InsecureContextError extends Error {
  constructor() {
    super("Web Crypto is unavailable in this browsing context");
    this.name = "InsecureContextError";
  }
}

/** Whether this context can hash at all. */
export function hasSubtleCrypto(): boolean {
  return typeof globalThis.crypto?.subtle?.digest === "function";
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function sha256Hex(str: string): Promise<string> {
  if (!hasSubtleCrypto()) throw new InsecureContextError();
  const data = new TextEncoder().encode(str);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", data);
  return toHex(digest);
}

/**
 * Prove ownership without sending the view key. Hashed here, and only the
 * digest goes out, so deleting never puts key material back on the wire.
 */
export async function computeOwnerKey(
  publicAddress: string,
  privateViewKey: string,
): Promise<string> {
  return sha256Hex(ownerKeyInput(publicAddress, privateViewKey));
}

/** Clear a field that held a secret, attribute included. */
export function wipeInput(el: HTMLInputElement | null | undefined): void {
  if (!el) return;
  try {
    el.value = "";
    el.setAttribute("value", "");
  } catch {
    // A detached or read-only node is not worth failing a submit over.
  }
}
