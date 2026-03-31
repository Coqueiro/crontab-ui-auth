#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_PID_FILE="$SCRIPT_DIR/crontab-ui.pid"
PROXY_PID_FILE="$SCRIPT_DIR/auth-proxy.pid"

BACKEND_PORT=8434
PROXY_PORT=8433

stop_process() {
    local pid_file="$1" name="$2" use_sudo="${3:-}"
    if [[ ! -f "$pid_file" ]]; then
        echo "$name is not running (no PID file)"
        return
    fi

    local pid
    pid=$(cat "$pid_file")

    if ${use_sudo} kill -0 "$pid" 2>/dev/null; then
        echo "Stopping $name (PID $pid)..."
        ${use_sudo} kill "$pid" 2>/dev/null || true
        # Wait up to 5 seconds for graceful shutdown
        for i in 1 2 3 4 5; do
            ${use_sudo} kill -0 "$pid" 2>/dev/null || break
            sleep 1
        done
        # Force kill if still running
        ${use_sudo} kill -9 "$pid" 2>/dev/null || true
        echo "  $name stopped"
    else
        echo "$name is not running (stale PID file)"
    fi

    rm -f "$pid_file"
}

# Kill any process listening on a given port
kill_port() {
    local port="$1" use_sudo="${2:-}"
    local pid
    pid=$(${use_sudo} lsof -ti :"$port" 2>/dev/null || true)
    if [[ -n "$pid" ]]; then
        echo "Killing process on port $port (PID $pid)..."
        ${use_sudo} kill "$pid" 2>/dev/null || true
        sleep 1
        ${use_sudo} kill -9 "$pid" 2>/dev/null || true
    fi
}

stop_process "$PROXY_PID_FILE" "auth-proxy"
stop_process "$BACKEND_PID_FILE" "crontab-ui" "sudo"

# Fallback: kill anything still on our ports
kill_port "$PROXY_PORT"
kill_port "$BACKEND_PORT" "sudo"
