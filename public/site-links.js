(() => {
  try {
    const host = (location.hostname || "").toLowerCase();

    // Onion: never rewrite (safe default)
    if (host.endsWith(".onion")) return;

    // Only rewrite on known clearnet mirrors (+ dev)
    const CLEARNET_HOSTS = new Set([
      "anonomi.org",
      "www.anonomi.org",
      "anonomi-org.github.io",
      "localhost",
      "127.0.0.1",
    ]);

    if (!CLEARNET_HOSTS.has(host)) return;

    // Rewrite hrefs
    document.querySelectorAll("[data-clearnet-href]").forEach((el) => {
      const href = el.getAttribute("data-clearnet-href");
      if (href) el.setAttribute("href", href);
    });

    // Rewrite text
    document.querySelectorAll("[data-clearnet-text]").forEach((el) => {
      const text = el.getAttribute("data-clearnet-text");
      if (text) el.textContent = text;
    });
  } catch {
    // fail silently
  }
})();