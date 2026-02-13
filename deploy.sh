#!/bin/bash
set -e

APP_DIR="/opt/clearmind"
REPO_DIR="/opt/clearmind-repo"
BRANCH="main"
REPO_URL="https://github.com/BenHilderman/journal-app.git"

# prevent git from prompting for credentials in non-interactive deploy
export GIT_TERMINAL_PROMPT=0

echo "==> Ensuring repo points to $REPO_URL..."
cd "$REPO_DIR"
CURRENT_URL=$(git remote get-url origin 2>/dev/null || echo "")
if [ "$CURRENT_URL" != "$REPO_URL" ]; then
  echo "==> Switching remote from $CURRENT_URL to $REPO_URL"
  git remote set-url origin "$REPO_URL"
fi

echo "==> Pulling latest from $BRANCH..."
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
