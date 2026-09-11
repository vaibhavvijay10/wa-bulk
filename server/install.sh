#!/usr/bin/env bash
# One-shot installer for Ubuntu/Debian VPS. Run as root (or with sudo) from inside the wa-bulk folder:
#   sudo bash install.sh
set -euo pipefail

if ! command -v docker >/dev/null 2>&1; then
  echo "Installing Docker…"
  curl -fsSL https://get.docker.com | sh
fi
if ! docker compose version >/dev/null 2>&1; then
  echo "Installing Docker Compose plugin…"
  apt-get update && apt-get install -y docker-compose-plugin
fi

if [ ! -f .env ]; then
  cp .env.example .env
  PASS=$(tr -dc 'A-Za-z0-9' </dev/urandom | head -c 16)
  sed -i "s/^ADMIN_PASSWORD=.*/ADMIN_PASSWORD=${PASS}/" .env
  echo
  echo "Created .env with a random admin password: ${PASS}"
  echo "Edit .env now to set DOMAIN (your hostname or http://YOUR.IP), then re-run this script."
  echo
  exit 0
fi

mkdir -p data
chown -R 1000:1000 data   # 'node' user inside the container

echo "Building and starting…"
docker compose up -d --build

echo
echo "Done. Open https://$(grep ^DOMAIN= .env | cut -d= -f2 | sed 's#^https\?://##')"
echo "Login: $(grep ^ADMIN_USER= .env | cut -d= -f2) / $(grep ^ADMIN_PASSWORD= .env | cut -d= -f2)"
echo "Then go to WhatsApp → Connect and scan the QR from the phone (Linked devices)."
echo
echo "Useful:  docker compose logs -f wa-bulk   |   docker compose restart wa-bulk   |   docker compose down"
