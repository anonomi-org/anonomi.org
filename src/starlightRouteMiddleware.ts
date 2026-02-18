import { defineRouteMiddleware } from "@astrojs/starlight/route-data";
import type { StarlightRouteData } from "@astrojs/starlight/route-data";

/**
 * Starlight route middleware that rewrites sidebar/pagination/title hrefs
 * to include the `/docs/` prefix.
 *
 * Starlight generates pages at the root (e.g. `/manifesto/`) but this site
 * mounts docs under `/docs/` via `src/pages/docs/[...slug].astro`, so all
 * internal links need the prefix.
 */
export const onRequest = defineRouteMiddleware((context) => {
  const route = context.locals.starlightRoute;
  const currentPath = context.url.pathname;

  // Rewrite sidebar links
  rewriteSidebar(route.sidebar);

  // Re-compute isCurrent after href rewriting
  clearIsCurrent(route.sidebar);
  markCurrent(route.sidebar, currentPath);

  // Recompute pagination from the rewritten sidebar since the original
  // pagination was computed before hrefs were rewritten, leaving it empty.
  const flatLinks = flattenSidebar(route.sidebar);
  const currentIndex = flatLinks.findIndex((entry) => entry.isCurrent);
  route.pagination = {
    prev: currentIndex > 0 ? flatLinks[currentIndex - 1] : undefined,
    next:
      currentIndex >= 0 && currentIndex < flatLinks.length - 1
        ? flatLinks[currentIndex + 1]
        : undefined,
  };

  // Keep site title (logo) linking to the homepage, not /docs/
  // Starlight sets this to "/" for English and "/pt/" for Portuguese, which is correct.
});

function addDocsPrefix(href: string): string {
  // Skip external URLs and already-prefixed paths
  if (href.startsWith("http") || href.startsWith("/docs")) return href;
  // /manifesto/ → /docs/manifesto/
  // /pt/manifesto/ → /docs/pt/manifesto/
  return "/docs" + (href.startsWith("/") ? href : "/" + href);
}

type SidebarEntry = StarlightRouteData["sidebar"][number];
type SidebarLink = Extract<SidebarEntry, { type: "link" }>;

function rewriteSidebar(entries: SidebarEntry[]) {
  for (const entry of entries) {
    if (entry.type === "link") {
      entry.href = addDocsPrefix(entry.href);
    } else if (entry.type === "group") {
      rewriteSidebar(entry.entries);
    }
  }
}

function clearIsCurrent(entries: SidebarEntry[]) {
  for (const entry of entries) {
    if (entry.type === "link") {
      entry.isCurrent = false;
    } else if (entry.type === "group") {
      clearIsCurrent(entry.entries);
    }
  }
}

function markCurrent(entries: SidebarEntry[], pathname: string): boolean {
  for (const entry of entries) {
    if (entry.type === "link" && pathsMatch(entry.href, pathname)) {
      entry.isCurrent = true;
      return true;
    }
    if (entry.type === "group" && markCurrent(entry.entries, pathname)) {
      return true;
    }
  }
  return false;
}

function flattenSidebar(entries: SidebarEntry[]): SidebarLink[] {
  const result: SidebarLink[] = [];
  for (const entry of entries) {
    if (entry.type === "link") {
      result.push(entry);
    } else if (entry.type === "group") {
      result.push(...flattenSidebar(entry.entries));
    }
  }
  return result;
}

function pathsMatch(a: string, b: string): boolean {
  const normalize = (p: string) =>
    decodeURIComponent(p).replace(/\/$/, "") || "/";
  return normalize(a) === normalize(b);
}
