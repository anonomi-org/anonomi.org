import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";
import starlight from "@astrojs/starlight";
import react from "@astrojs/react";

import { LOCALES, defaultLocale } from "./src/i18n/locales.ts";
import { CLEARNET_REPO_BASE, ONION_SITE_BASE, networkOf } from "./src/lib/site.ts";

// The config runs in Node, where import.meta.env has no PUBLIC_ values yet, so
// the network is read from the process environment the deploy exports.
const isOnionBuild = networkOf(process.env.PUBLIC_SITE_BASE_URL ?? "") === "onion";

// Starlight serves the default locale from the root, and keys every other
// locale by its path segment. Built from src/i18n/locales.ts so the language
// menu, the docs and the standalone pages cannot drift apart.
const starlightLocales = Object.fromEntries(
  LOCALES.map(({ code, label, dir }) => [
    code === defaultLocale ? "root" : code,
    { label, lang: code, ...(dir === "rtl" ? { dir } : {}) },
  ]),
);

export default defineConfig({
  site: "https://anonomi.org",

  vite: {
    plugins: [tailwindcss()],
  },

  integrations: [
    react(),
    starlight({
      defaultLocale: 'root',
      locales: starlightLocales,

      // The same two tags the marketing pages carry, see
      // src/layouts/Layout.astro.
      head: [
        { tag: "meta", attrs: { name: "referrer", content: "no-referrer" } },
        ...(isOnionBuild
          ? []
          : [
              {
                tag: "meta",
                attrs: { "http-equiv": "onion-location", content: ONION_SITE_BASE },
              },
            ]),
      ],

      // Puts the docs on the same palette as the marketing pages.
      customCss: ['./src/styles/docs-theme.css'],
      routeMiddleware: ['./src/starlightRouteMiddleware.ts'],
      title: "Anonomi Docs",
      logo: {
        src: "./src/assets/logo.png",
        alt: "Anonomi",
        replacesTitle: true,
      },
      social: [
        {
          icon: "github",
          label: "GitHub",
          href: "https://github.com/anonomi-org",
        },
      ],

      // Starlight appends the file's path from the project root, so the base
      // stops at the branch — including src/content/docs/ here doubled it.
      //
      // Left off on the onion: the mirror there is Gitea, whose edit route is
      // /_edit/ rather than /edit/, and a mirror is not somewhere a change can
      // be submitted. A dead button is worse than no button.
      editLink: isOnionBuild
        ? {}
        : { baseUrl: `${CLEARNET_REPO_BASE}/anonomi.org/edit/main/` },

      sidebar: [
        {
          label: "Start here",
          translations: { pt: "Começar aqui" },
          items: [
            { label: "What is Anonomi?", slug: "index", translations: { pt: "O que é o Anonomi?" } },
            { label: "Manifesto", slug: "manifesto", translations: { pt: "Manifesto" } },
            { label: "Threat model", slug: "security/threat-model", translations: { pt: "Modelo de ameaças" } },
            { label: "Onion Services", slug: "onion-services", translations: { pt: "Serviços Onion" } },
            { label: "Tor is not the Dark Web", slug: "tor", translations: { pt: "Tor não é a Dark Web" } },
            { label: "Maps Exporter", slug: "maps-exporter", translations: { pt: "Exportador de Mapas" } },
          ],
        },
        {
          label: "Features",
          translations: { pt: "Funcionalidades" },
          items: [
            { label: "Online + Offline connectivity", slug: "features/connectivity", translations: { pt: "Conectividade online + offline" } },
            { label: "Crypto payments (Monero)", slug: "features/monero", translations: { pt: "Pagamentos cripto (Monero)" } },
            { label: "Voice messages + distortion", slug: "features/voice", translations: { pt: "Mensagens de voz + distorção" } },
            { label: "Walkie-Talkie mode", slug: "features/walkie-talkie", translations: { pt: "Modo Walkie-Talkie" } },
            { label: "Offline maps", slug: "features/maps", translations: { pt: "Mapas offline" } },
            { label: "Stealth mode", slug: "features/stealth", translations: { pt: "Modo furtivo" } },
            { label: "Offline app distribution", slug: "features/distribution", translations: { pt: "Distribuição offline da app" } },
            { label: "Panic button + panic contacts", slug: "features/panic", translations: { pt: "Botão de pânico + contactos de pânico" } },
          ],
        },
        {
          label: "Using Anonomi Messenger",
          translations: { pt: "Usar o Anonomi Messenger" },
          items: [
            { label: "Installation", slug: "usage/installation", translations: { pt: "Instalação" } },
            { label: "Creating an account", slug: "usage/creating-an-account", translations: { pt: "Criar uma conta" } },
            { label: "Adding contacts", slug: "usage/adding-contacts", translations: { pt: "Adicionar contactos" } },
            { label: "Introducing contacts", slug: "usage/introducing-contacts", translations: { pt: "Apresentar contactos" } },
            { label: "Messaging", slug: "usage/messaging", translations: { pt: "Mensagens" } },
            { label: "Contact Settings", slug: "usage/contact-settings", translations: { pt: "Definições de contacto" } },
            { label: "Private Groups", slug: "usage/private-groups", translations: { pt: "Grupos privados" } },
            { label: "Public Groups", slug: "usage/public-groups", translations: { pt: "Grupos públicos" } },
            { label: "Deleting Contacts", slug: "usage/deleting-contacts", translations: { pt: "Eliminar contactos" } },
            { label: "Operational security basics", slug: "usage/opsec", translations: { pt: "Noções básicas de segurança operacional" } },
            { label: "Scenarios and tradeoffs", slug: "usage/scenarios", translations: { pt: "Cenários e compromissos" } },
            {
              label: "Settings",
              translations: { pt: "Definições" },
              items: [
                { label: "Overview", slug: "usage/settings", translations: { pt: "Visão geral" } },
                { label: "Display", slug: "usage/settings/display", translations: { pt: "Ecrã" } },
                { label: "Connections", slug: "usage/settings/connections", translations: { pt: "Ligações" } },
                { label: "Security", slug: "usage/settings/security", translations: { pt: "Segurança" } },
                { label: "Notifications", slug: "usage/settings/notifications", translations: { pt: "Notificações" } },
                { label: "Anonomi Postbox", slug: "usage/settings/postbox", translations: { pt: "Anonomi Postbox" } },
                { label: "Monero", slug: "usage/settings/monero", translations: { pt: "Monero" } },
                { label: "Offline Maps", slug: "usage/settings/offline-maps", translations: { pt: "Mapas offline" } },
                { label: "Share this app offline", slug: "usage/settings/share-offline", translations: { pt: "Partilhar esta app offline" } },
              ],
            },
            { label: "FAQ", slug: "faq", translations: { pt: "FAQ" } },
          ],
        },
        {
          label: "Get it",
          translations: { pt: "Obter" },
          items: [
            { label: "Downloads", slug: "downloads", translations: { pt: "Transferências" } },
            { label: "Verify downloads", slug: "verify", translations: { pt: "Verificar transferências" } },
          ],
        },
        {
          label: "Anonomi Paylinks",
          translations: { pt: "Anonomi Paylinks" },
          items: [
            { label: "What is Paylinks?", slug: "paylinks/what-is", translations: { pt: "O que é o Paylinks?" } },
            { label: "Privacy", slug: "paylinks/privacy", translations: { pt: "Privacidade" } },
            { label: "Infrastructure & Data Security", slug: "paylinks/infrastructure", translations: { pt: "Infraestrutura e segurança de dados" } },
            { label: "Why Paylinks runs only on Tor", slug: "paylinks/tor-separation", translations: { pt: "Por que o Paylinks só funciona no Tor" } },
          ],
        },
        {
          label: "Project",
          translations: { pt: "Projeto" },
          items: [
            { label: "Support us", slug: "support-us", translations: { pt: "Apoiar-nos" } },
            { label: "Contributing", slug: "contributing", translations: { pt: "Contribuir" } },
            { label: "License", slug: "legal/license", translations: { pt: "Licença" } },
          ],
        },
      ],
    }),
  ],
});