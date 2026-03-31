#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_PID_FILE="$SCRIPT_DIR/crontab-ui.pid"
PROXY_PID_FILE="$SCRIPT_DIR/auth-proxy.pid"

stop_process() {
    local pid_file="$1" name="$2"
    if [[ ! -f "$pid_file" ]]; then
        echo "$name is not running (no PID file)"
        return
    fi

    local pid
    pid=$(cat "$pid_file")

    if kill -0 "$pid" 2>/dev/null; then
        echo "Stopping $name (PID $pid)..."
        kill "$pid" 2>/dev/null || true
        sleep 1
        if kill -0 "$pid" 2>/dev/null; then
            kill -9 "$pid" 2>/dev/null || true
        fi
        echo "  $name stopped"
    else
        echo "$name is not running (stale PID file)"
    fi

    rm -f "$pid_file"
}

stop_process "$PROXY_PID_FILE" "auth-proxy"
stop_process "$BACKEND_PID_FILE" "crontab-ui"
