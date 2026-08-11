/**
 * The locales this site ships, in the order they appear in the language menu.
 *
 * This is the only list. `astro.config.mjs` builds Starlight's locale config
 * from it, `utils.ts` resolves translations against it, `Layout.astro` reads
 * the text direction from it, and the pages under `src/pages/[...locale]/`
 * generate one route per entry.
 *
 * Adding a locale is this array plus a matching `<code>.json`.
 */
export const LOCALES = [
  { code: "en", label: "English", dir: "ltr" },
  { code: "pt", label: "Português", dir: "ltr" },
  { code: "es", label: "Español", dir: "ltr" },
  { code: "ar", label: "العربية", dir: "rtl" },
  { code: "fa", label: "فارسی", dir: "rtl" },
  { code: "zh", label: "中文", dir: "ltr" },
] as const;

export type Locale = (typeof LOCALES)[number]["code"];
export type Direction = (typeof LOCALES)[number]["dir"];

/** English is served unprefixed at the site root, so it has no path segment. */
export const defaultLocale: Locale = "en";

export const locales: readonly Locale[] = LOCALES.map((l) => l.code);

/** Locales that carry a path prefix, i.e. everything but the default. */
export const prefixedLocales: readonly Locale[] = locales.filter(
  (l) => l !== defaultLocale,
);

export const localeLabels = Object.fromEntries(
  LOCALES.map((l) => [l.code, l.label]),
) as Record<Locale, string>;

const directions = Object.fromEntries(
  LOCALES.map((l) => [l.code, l.dir]),
) as Record<Locale, Direction>;

/** Text direction for a locale; unknown input reads left-to-right. */
export function directionOf(locale: string): Direction {
  return directions[locale as Locale] ?? "ltr";
}

/**
 * One route per locale for the pages under `src/pages/[...locale]/`.
 *
 * The default locale gets `undefined`, which Astro renders at the root: `/`
 * and `/messenger`, with the rest at `/pt/`, `/pt/messenger` and so on.
 */
export function localeStaticPaths() {
  return LOCALES.map(({ code }) => ({
    params: { locale: code === defaultLocale ? undefined : code },
  }));
}
