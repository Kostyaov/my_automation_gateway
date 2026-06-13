#!/bin/zsh

set -e

PROJECT_DIR="$(cd "$(dirname "$0")/my_automation_gateway" && pwd)"
APP_URL="http://127.0.0.1:8000/"
HEALTH_URL="http://127.0.0.1:8000/api/health"

cd "$PROJECT_DIR"

echo "Local Automation Gateway"
echo "Project: $PROJECT_DIR"
echo

if [ -f ".env" ]; then
  echo "Loading environment from .env"
  set -a
  source ".env"
  set +a
fi

if curl -fsS "$HEALTH_URL" >/dev/null 2>&1; then
  echo "Server is already running:"
  echo "$APP_URL"
  open "$APP_URL"
  exit 0
fi

if [ ! -x ".venv/bin/python" ]; then
  echo "Creating Python virtual environment..."
  python3 -m venv .venv
fi

REQUIREMENTS_HASH="$(shasum -a 256 requirements.txt | awk '{print $1}')"
INSTALLED_HASH=""
if [ -f ".venv/.requirements-installed" ]; then
  INSTALLED_HASH="$(cat .venv/.requirements-installed)"
fi

if [ ! -d ".venv/lib" ] || [ "$INSTALLED_HASH" != "$REQUIREMENTS_HASH" ]; then
  echo "Installing Python dependencies..."
  .venv/bin/python -m pip install -r requirements.txt
  echo "$REQUIREMENTS_HASH" > .venv/.requirements-installed
fi

echo "Starting server on $APP_URL"
echo "Close this Terminal window or press Ctrl+C to stop the server."
echo

(sleep 2 && open "$APP_URL") &

exec .venv/bin/python -m uvicorn main:app --host 127.0.0.1 --port 8000 --loop asyncio
