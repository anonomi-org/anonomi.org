import en from './en.json';
import pt from './pt.json';
import es from './es.json';
import ar from './ar.json';
import fa from './fa.json';
import zh from './zh.json';

import { defaultLocale, locales, prefixedLocales } from './locales';
import type { Locale } from './locales';

const translations: Record<string, Record<string, string>> = { en, pt, es, ar, fa, zh };

export { defaultLocale, locales, localeLabels, directionOf } from './locales';
export type { Locale } from './locales';

/**
 * Get a translated string by key. Falls back to English if the key
 * is missing in the requested locale.
 */
export function t(lang: string, key: string): string {
  return translations[lang]?.[key] ?? translations[defaultLocale]?.[key] ?? key;
}

/**
 * Detect the locale from a URL pathname.
 * Returns the locale code for /{locale}/... or /docs/{locale}/..., otherwise 'en'.
 */
export function getLangFromUrl(url: URL): Locale {
  const [, first, second] = url.pathname.split('/');
  // Standalone pages: /pt/..., /es/..., etc.
  if (locales.includes(first as Locale) && first !== defaultLocale) {
    return first as Locale;
  }
  // Starlight docs: /docs/pt/..., /docs/es/..., etc.
  if (first === 'docs' && locales.includes(second as Locale) && second !== defaultLocale) {
    return second as Locale;
  }
  return defaultLocale;
}

// Regex that matches any non-default locale code as a path segment
const localePattern = prefixedLocales.join('|');
const docsLocaleRe = new RegExp(`^\\/docs\\/(${localePattern})(\\/|$)`);
const standaloneLocaleRe = new RegExp(`^\\/(${localePattern})(\\/|$)`);

/**
 * Get the localized path for a given pathname and target locale.
 *
 * Starlight docs use /docs/{locale}/... while standalone pages use /{locale}/...
 *
 * Examples:
 *   localizedPath('/messenger', 'pt')      → '/pt/messenger'
 *   localizedPath('/pt/messenger', 'en')   → '/messenger'
 *   localizedPath('/docs/', 'pt')          → '/docs/pt/'
 *   localizedPath('/docs/pt/', 'en')       → '/docs/'
 *   localizedPath('/docs/manifesto', 'pt') → '/docs/pt/manifesto'
 */
export function localizedPath(pathname: string, locale: Locale): string {
  const isDocsPath = pathname.startsWith('/docs');

  if (isDocsPath) {
    // Strip existing locale from docs path: /docs/pt/... → /docs/...
    const stripped = pathname.replace(docsLocaleRe, '/docs/');
    if (locale === defaultLocale) {
      return stripped;
    }
    // Insert locale after /docs: /docs/... → /docs/pt/...
    return stripped.replace(/^\/docs\/?/, `/docs/${locale}/`);
  }

  // Standalone pages: strip existing locale prefix
  const stripped = pathname.replace(standaloneLocaleRe, '/');
  if (locale === defaultLocale) {
    return stripped || '/';
  }
  return `/${locale}${stripped === '/' ? '' : stripped}`;
}
