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
# - Syncs the generated files to the nginx web root
# - Copies onion-specific server assets
# - Fixes ownership and permissions
#
# What this script does NOT do:
# - It does not run in CI
# - It does not publish to GitHub Pages
# - It does not make network calls beyond dependency installation
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

echo "[1/5] Updating repo..."
git pull --ff-only

echo "[2/5] Installing dependencies..."
npm ci

echo "[3/5] Building site..."
# Bake the exact git commit into the static build (used by import.meta.env.PUBLIC_BUILD_SHA)
export PUBLIC_BUILD_SHA="$(git rev-parse HEAD)"
npm run build

echo "[4/5] Deploying to nginx root..."

WEB_ROOT="${WEB_ROOT:-/var/www/anonomi}"
sudo rsync -a --delete ./dist/ "$WEB_ROOT/"

echo "[4.1/5] Copying server extras..."
sudo cp -f ./server-extras/onion.html "$WEB_ROOT/onion.html"

echo "[5/5] Fixing permissions..."
sudo chown -R www-data:www-data "$WEB_ROOT"
sudo find "$WEB_ROOT" -type d -exec chmod 755 {} \;
sudo find "$WEB_ROOT" -type f -exec chmod 644 {} \;

echo "Done."

