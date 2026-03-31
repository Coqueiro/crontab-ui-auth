#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="$SCRIPT_DIR/.env"
BACKEND_PID_FILE="$SCRIPT_DIR/crontab-ui.pid"
PROXY_PID_FILE="$SCRIPT_DIR/auth-proxy.pid"
BACKEND_LOG="$SCRIPT_DIR/crontab-ui.log"
PROXY_LOG="$SCRIPT_DIR/auth-proxy.log"

BACKEND_PORT=8434
PROXY_PORT=8433

# Load env
if [[ ! -f "$ENV_FILE" ]]; then
    echo "ERROR: $ENV_FILE not found. Run install.sh first."
    exit 1
fi
source "$ENV_FILE"

# Stop existing instances
stop_process() {
    local pid_file="$1" name="$2"
    if [[ -f "$pid_file" ]]; then
        local pid
        pid=$(cat "$pid_file")
        if kill -0 "$pid" 2>/dev/null; then
            echo "Stopping $name (PID $pid)..."
            kill "$pid" 2>/dev/null || true
            sleep 1
            kill -0 "$pid" 2>/dev/null && kill -9 "$pid" 2>/dev/null || true
        fi
        rm -f "$pid_file"
    fi
}

stop_process "$BACKEND_PID_FILE" "crontab-ui"
stop_process "$PROXY_PID_FILE" "auth-proxy"

# Start crontab-ui on localhost only
echo "Starting crontab-ui on 127.0.0.1:$BACKEND_PORT..."
sudo env "PATH=$PATH" HOST=127.0.0.1 PORT=$BACKEND_PORT nohup crontab-ui > "$BACKEND_LOG" 2>&1 &
echo $! > "$BACKEND_PID_FILE"

sleep 1
if ! kill -0 "$(cat "$BACKEND_PID_FILE")" 2>/dev/null; then
    echo "Failed to start crontab-ui. Check $BACKEND_LOG"
    rm -f "$BACKEND_PID_FILE"
    exit 1
fi
echo "  crontab-ui running (PID $(cat "$BACKEND_PID_FILE"))"

# Start auth proxy
echo "Starting auth proxy on 0.0.0.0:$PROXY_PORT..."
AUTH_PASSWORD_HASH="$AUTH_PASSWORD_HASH" \
SESSION_SECRET="$SESSION_SECRET" \
PORT=$PROXY_PORT \
BACKEND_URL="http://127.0.0.1:$BACKEND_PORT" \
nohup node "$SCRIPT_DIR/auth-proxy.js" > "$PROXY_LOG" 2>&1 &
echo $! > "$PROXY_PID_FILE"

sleep 1
if ! kill -0 "$(cat "$PROXY_PID_FILE")" 2>/dev/null; then
    echo "Failed to start auth proxy. Check $PROXY_LOG"
    rm -f "$PROXY_PID_FILE"
    exit 1
fi
echo "  auth proxy running (PID $(cat "$PROXY_PID_FILE"))"

echo ""
echo "crontab-ui available at http://localhost:$PROXY_PORT (password protected)"
echo "Logs: $BACKEND_LOG, $PROXY_LOG"
