import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";
import starlight from "@astrojs/starlight";
import react from "@astrojs/react";

export default defineConfig({
  site: "https://anonomi.org",

  vite: {
    plugins: [tailwindcss()],
  },

  integrations: [
    react(),
    starlight({
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

      editLink: {
        baseUrl:
          "https://github.com/anonomi-org/anonomi.github.io/edit/main/src/content/docs/",
      },

      sidebar: [
        {
          label: "Start here",
          items: [
            { label: "What is Anonomi?", link: "/docs/" },
            { label: "Manifesto", link: "/docs/manifesto" },
            { label: "Threat model", link: "/docs/security/threat-model" },
            { label: "Onion Services", link: "/docs/onion-services" },
            { label: "Maps Exporter", link: "/docs/maps-exporter" },
          ],
        },
        {
          label: "Features",
          items: [
            { label: "Online + Offline connectivity", link: "/docs/features/connectivity" },
            { label: "Crypto payments (Monero)", link: "/docs/features/monero" },
            { label: "Voice messages + distortion", link: "/docs/features/voice" },
            { label: "Offline maps", link: "/docs/features/maps" },
            { label: "Stealth mode", link: "/docs/features/stealth" },
            { label: "Offline app distribution", link: "/docs/features/distribution" },
            { label: "Panic button + panic contacts", link: "/docs/features/panic" },
          ],
        },
        {
          label: "Anonomi Paylinks",
          items: [
            { label: "What is Paylinks?", link: "/docs/paylinks/what-is" },
            { label: "Privacy", link: "/docs/paylinks/privacy" },
          ],
        },
        {
          label: "Using Anonomi Messenger",
          items: [
            { label: "Installation", link: "/docs/usage/installation" },
            { label: "Creating an account", link: "/docs/usage/creating-an-account" },
            { label: "Adding contacts", link: "/docs/usage/adding-contacts" },
            { label: "Introducing contacts", link: "/docs/usage/introducing-contacts" },
            { label: "Messaging", link: "/docs/usage/messaging" },
            { label: "Contact Settings", link: "/docs/usage/contact-settings" },
            { label: "Private Groups", link: "/docs/usage/private-groups" },
            { label: "Public Groups", link: "/docs/usage/public-groups" },
            { label: "Deleting Contacts", link: "/docs/usage/deleting-contacts" },
            { label: "Operational security basics", link: "/docs/usage/opsec" },
            { label: "Scenarios and tradeoffs", link: "/docs/usage/scenarios" },
            {
              label: "Settings",
              items: [
                { label: "Overview", link: "/docs/usage/settings" },
                { label: "Display", link: "/docs/usage/settings/display" },
                { label: "Connections", link: "/docs/usage/settings/connections" },
                { label: "Security", link: "/docs/usage/settings/security" },
                { label: "Notifications", link: "/docs/usage/settings/notifications" },
                { label: "Anonomi Postbox", link: "/docs/usage/settings/mailbox" },
                { label: "Monero", link: "/docs/usage/settings/monero" },
                { label: "Offline Maps", link: "/docs/usage/settings/offline-maps" },
                { label: "Share this app offline", link: "/docs/usage/settings/share-offline" },
              ],
            },
            { label: "FAQ", link: "/docs/faq" },
          ],
        },
        {
          label: "Get it",
          items: [
            { label: "Downloads", link: "/docs/downloads" },
            { label: "Verify downloads", link: "/docs/verify" },
          ],
        },
        {
          label: "Project",
          items: [
            { label: "Support us", link: "/docs/support-us" },
            { label: "Contributing", link: "/docs/contributing" },
            { label: "License", link: "/docs/legal/license" },
          ],
        },
      ],
    }),
  ],
});