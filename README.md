# Anonomi Website

The official website for [Anonomi](https://anonomi.org) — a privacy suite for high-threat environments.

## What's Included

- **Homepage & Documentation** — Project information, manifesto, and user guides
- **[Anonomi Paylinks](https://anonomi.org/paylinks)** — Privacy-preserving donation buttons using Monero subaddresses
- **[Anonomi Maps](https://anonomi.org/maps)** — Browser-based offline map tile exporter

## Live Sites

| Network | URL |
|---------|-----|
| Clearnet | https://anonomi.org |
| Onion | http://ucvmhctoq76k6qrdrvblxspjpk5rpjutsfe6nxyhgmvx25vruohxrnqd.onion |

## Tech Stack

- [Astro](https://astro.build) — static site generator
- [Starlight](https://starlight.astro.build) — documentation
- [Tailwind CSS](https://tailwindcss.com) — styling
- [React](https://react.dev) — interactive components

## Development

```bash
# Install dependencies
npm install

# Start dev server
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview
```

The dev server runs at `http://localhost:4321`.

## Project Structure

```
src/
├── components/     # Reusable UI components
├── content/docs/   # Starlight documentation (MDX)
├── layouts/        # Page layouts
├── pages/          # Astro pages
│   ├── index.astro       # Homepage
│   ├── messenger.astro   # Anonomi Messenger
│   ├── paylinks/         # Anonomi Paylinks
│   └── maps.astro        # Anonomi Maps
└── assets/         # Static assets
```

## Deployment

**Clearnet:** Deployed via GitHub Actions on push to `main`.

**Onion:** Manual deployment using `deploy-onion.sh`.

Environment variables:
- `PUBLIC_BUILD_SHA` — Git commit hash
- `PUBLIC_SITE_BASE_URL` — Base URL (clearnet or onion)
- `PUBLIC_PAYLINKS_API_BASE` — Paylinks API endpoint

## Contributing

Contributions welcome. See [Contributing](https://anonomi.org/docs/contributing) for guidelines.

## License

See [License](https://anonomi.org/docs/legal/license).

---

No trackers. No analytics. No cookies.
