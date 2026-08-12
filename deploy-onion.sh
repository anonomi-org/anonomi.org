#!/usr/bin/env bash
#
# Anonomi — Onion Website Deployment Script
#
# This script deploys the Anonomi website to a self-hosted server
# running as a Tor onion service.
#
# It is intentionally separate from GitHub Pages deployment:
# - GitHub Pages is used for clearnet distribution
# - This script is used for the independently hosted onion mirror
#
# What this script does:
# - Updates the local repository (fast-forward only)
# - Installs dependencies locally
# - Builds the static site
# - Audits the build before it reaches the web root
# - Syncs the generated files to the nginx web root
# - Copies onion-specific server assets
# - Fixes ownership and permissions
#
# What this script does NOT do:
# - It does not run in CI
# - It does not publish to GitHub Pages
# - It makes no network calls beyond `npm ci` and the GitHub releases API
#   the downloads page is built from (two requests, see step 3)
#
# Threat model notes:
# - The onion website is built from the same source code as the clearnet site
# - Build output can be verified against the public repository
# - No analytics, trackers, or third-party scripts are added during deployment
#
# Usage:
#   Run manually on the onion host:
#     ./deploy-onion.sh
#
# Requirements:
# - Node.js and npm installed
# - nginx configured to serve /var/www/anonomi
# - Tor onion service pointing to the nginx instance
#
# This script is part of the Anonomi project and is provided
# for transparency, auditability, and reproducible deployment.
#
set -euo pipefail

cd "$(dirname "$0")"

echo "[1/6] Updating repo..."
git pull --ff-only

echo "[2/6] Installing dependencies..."
npm ci

echo "[3/6] Building site..."
# Bake the exact git commit into the static build (used by import.meta.env.PUBLIC_BUILD_SHA)
export PUBLIC_BUILD_SHA="$(git rev-parse HEAD)"
# Onion-specific URLs for Paylinks
export PUBLIC_SITE_BASE_URL="http://dwbgp2zfjqxcrk6fk3j7tr5uyqes4lxkipnsvm6atyi5eo7smsa6ykqd.onion"
export PUBLIC_PAYLINKS_API_BASE="http://b7o4bzmc5ylx3ynbg4pvxs4vwifviuzkonle66uzdrv5ff7vj5pln7yd.onion"

# The downloads page is built from the GitHub releases API and the build fails
# outright if it cannot be read. Anonymous callers get 60 requests an hour per
# IP; a token raises that to 5000. No token is stored on this box — pass one in
# over stdin from a machine that has the password store:
#
#   nc-pass get infra/github/anonomi-dl-poller --field password \
#     | ssh anon-web 'read -r T; cd /opt/anonomi.org && GITHUB_TOKEN="$T" ./deploy-onion.sh'
#
if [ -z "${GITHUB_TOKEN:-}" ]; then
  echo "  ! GITHUB_TOKEN unset — building against the 60/hour anonymous limit." >&2
fi

npm run build

# Before the rsync on purpose: a build that fails the checks has to stop here
# rather than once it is live. PUBLIC_SITE_BASE_URL above picks the onion rules.
echo "[4/6] Auditing build output..."
npm run audit:dist

echo "[5/6] Deploying to nginx root..."

WEB_ROOT="${WEB_ROOT:-/var/www/anonomi}"
sudo rsync -a --delete ./dist/ "$WEB_ROOT/"

echo "[5.1/6] Copying server extras..."
sudo cp -f ./server-extras/onion.html "$WEB_ROOT/onion.html"

echo "[6/6] Fixing permissions..."
sudo chown -R www-data:www-data "$WEB_ROOT"
sudo find "$WEB_ROOT" -type d -exec chmod 755 {} \;
sudo find "$WEB_ROOT" -type f -exec chmod 644 {} \;

echo "Done."

