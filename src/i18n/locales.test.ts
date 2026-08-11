import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// `t()` falls back to English when a key is missing, so an untranslated string
// renders in English instead of failing. These tests are what notices.

const locales = ["pt", "es", "ar", "fa", "zh"] as const;

function load(locale: string): Record<string, string> {
  const path = new URL(`./${locale}.json`, import.meta.url);
  return JSON.parse(readFileSync(path, "utf8"));
}

const en = load("en");
const enKeys = Object.keys(en).sort();

for (const locale of locales) {
  const strings = load(locale);

  test(`${locale} has every key English has`, () => {
    const missing = enKeys.filter((key) => !(key in strings));
    assert.deepEqual(missing, [], `${locale}.json is missing ${missing.length} key(s)`);
  });

  test(`${locale} has no keys English does not`, () => {
    const extra = Object.keys(strings).filter((key) => !(key in en));
    assert.deepEqual(extra, [], `${locale}.json has ${extra.length} stale key(s)`);
  });

  test(`${locale} leaves nothing blank that English fills`, () => {
    const blank = enKeys.filter((key) => en[key].trim() !== "" && strings[key]?.trim() === "");
    assert.deepEqual(blank, [], `${locale}.json has ${blank.length} blank string(s)`);
  });
}
