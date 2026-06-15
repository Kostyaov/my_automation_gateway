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

is_supported_python() {
  "$1" -c 'import sys; raise SystemExit(0 if (3, 11) <= sys.version_info[:2] <= (3, 13) else 1)' >/dev/null 2>&1
}

select_python() {
  for candidate in python3.12 python3.11 python3.13 python3; do
    if command -v "$candidate" >/dev/null 2>&1 && is_supported_python "$candidate"; then
      command -v "$candidate"
      return 0
    fi
  done
  return 1
}

if [ ! -f "requirements.txt" ]; then
  echo "requirements.txt was not found in:"
  echo "$PROJECT_DIR"
  exit 1
fi

PYTHON_BIN="$(select_python || true)"
if [ -z "$PYTHON_BIN" ]; then
  echo "Could not find a supported Python version."
  echo "Please install Python 3.12 or 3.11. Python 3.14 is not supported by the current dependencies yet."
  exit 1
fi

if [ -x ".venv/bin/python" ] && ! is_supported_python ".venv/bin/python"; then
  echo "Existing .venv uses an unsupported Python version. Recreating it..."
  rm -rf ".venv"
fi

if [ ! -x ".venv/bin/python" ]; then
  echo "Creating Python virtual environment..."
  "$PYTHON_BIN" -m venv .venv
fi

REQUIREMENTS_HASH="$(shasum -a 256 requirements.txt | awk '{print $1}')"
INSTALLED_HASH=""
if [ -f ".venv/.requirements-installed" ]; then
  INSTALLED_HASH="$(cat .venv/.requirements-installed)"
fi

if [ ! -d ".venv/lib" ] || [ "$INSTALLED_HASH" != "$REQUIREMENTS_HASH" ]; then
  echo "Installing Python dependencies..."
  .venv/bin/python -m pip install --upgrade pip setuptools wheel
  .venv/bin/python -m pip install -r requirements.txt
  echo "$REQUIREMENTS_HASH" > .venv/.requirements-installed
fi

echo "Starting server on $APP_URL"
echo "Close this Terminal window or press Ctrl+C to stop the server."
echo

(sleep 2 && open "$APP_URL") &

exec .venv/bin/python -m uvicorn main:app --host 127.0.0.1 --port 8000 --loop asyncio
