#!/bin/bash
set -e

APP_DIR="/opt/clearmind"
REPO_DIR="/opt/clearmind-repo"
BRANCH="main"

echo "==> Pulling latest from $BRANCH..."
cd "$REPO_DIR"
git fetch origin "$BRANCH"
git reset --hard "origin/$BRANCH"

echo "==> Syncing to $APP_DIR..."
rsync -a --delete \
  --exclude='.env' \
  --exclude='node_modules' \
  --exclude='.git' \
  --exclude='ecosystem.config.cjs' \
  "$REPO_DIR/" "$APP_DIR/"

echo "==> Installing dependencies..."
cd "$APP_DIR"
npm ci --production

echo "==> Restarting app..."
pm2 restart clearmind --update-env

echo "==> Deploy complete!"
pm2 status clearmind
