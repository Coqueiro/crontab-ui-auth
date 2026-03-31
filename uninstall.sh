#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "=== crontab-ui uninstaller ==="
echo ""

# 1. Remove auto-start and stop running processes
echo "[1/4] Stopping services and removing auto-start..."

if [[ "$(uname)" == "Darwin" ]]; then
    PLIST_FILE="$HOME/Library/LaunchAgents/com.crontab-ui.plist"
    if [[ -f "$PLIST_FILE" ]]; then
        launchctl unload "$PLIST_FILE" 2>/dev/null || true
        rm -f "$PLIST_FILE"
        echo "  launchd agent removed ✓"
    fi
else
    if [[ -f /etc/systemd/system/crontab-ui.service ]]; then
        sudo systemctl stop crontab-ui 2>/dev/null || true
        sudo systemctl disable crontab-ui 2>/dev/null || true
        sudo rm -f /etc/systemd/system/crontab-ui.service
        sudo systemctl daemon-reload
        echo "  systemd service removed ✓"
    fi
fi

if [[ -f "$SCRIPT_DIR/stop.sh" ]]; then
    bash "$SCRIPT_DIR/stop.sh" 2>/dev/null || true
fi
# Also kill any leftover crontab-ui or auth-proxy processes
sudo pkill -f "node.*crontab-ui" 2>/dev/null || true
pkill -f "node.*auth-proxy.js" 2>/dev/null || true
echo "  Services stopped ✓"

# 2. Remove crontab entries managed by crontab-ui
echo ""
echo "[2/4] Clearing crontab entries..."
# Save current crontab, check if it has crontab-ui managed entries
if sudo crontab -l &>/dev/null; then
    CURRENT_CRONTAB=$(sudo crontab -l 2>/dev/null || true)
    if echo "$CURRENT_CRONTAB" | grep -qE "(crontab-ui|\.stdout|\.stderr)" 2>/dev/null; then
        echo "  Found crontab-ui entries in root crontab."
        read -p "  Remove crontab-ui entries from root crontab? (y/N): " REMOVE_CRONTAB
        if [[ "${REMOVE_CRONTAB:-n}" =~ ^[Yy]$ ]]; then
            # Remove only crontab-ui managed entries, preserve everything else
            FILTERED_CRONTAB=$(echo "$CURRENT_CRONTAB" | grep -vE "(crontab-ui|\.stdout|\.stderr)" || true)
            if [[ -n "$FILTERED_CRONTAB" ]]; then
                echo "$FILTERED_CRONTAB" | sudo crontab -
                echo "  crontab-ui entries removed (other entries preserved) ✓"
            else
                sudo crontab -r 2>/dev/null || true
                echo "  Root crontab cleared (no other entries) ✓"
            fi
        else
            echo "  Skipped (crontab entries preserved)"
        fi
    else
        echo "  No crontab-ui entries found in root crontab."
    fi
else
    echo "  No root crontab found."
fi

# 3. Uninstall crontab-ui global package
echo ""
echo "[3/4] Uninstalling crontab-ui..."
if command -v crontab-ui &>/dev/null; then
    sudo env "PATH=$PATH" npm uninstall -g crontab-ui
    echo "  crontab-ui uninstalled ✓"
else
    echo "  crontab-ui not installed, skipping."
fi

# 4. Clean up local files
echo ""
echo "[4/4] Cleaning up local files..."
rm -f "$SCRIPT_DIR/crontab-ui.pid" "$SCRIPT_DIR/auth-proxy.pid"
rm -f "$SCRIPT_DIR/crontab-ui.log" "$SCRIPT_DIR/auth-proxy.log" "$SCRIPT_DIR/launchd.log"
rm -rf "$SCRIPT_DIR/node_modules"
rm -f "$SCRIPT_DIR/package-lock.json"

# Ask about .env (contains password hash)
if [[ -f "$SCRIPT_DIR/.env" ]]; then
    read -p "  Remove .env (password config)? (y/N): " REMOVE_ENV
    if [[ "${REMOVE_ENV:-n}" =~ ^[Yy]$ ]]; then
        rm -f "$SCRIPT_DIR/.env"
        echo "  .env removed ✓"
    else
        echo "  .env preserved (will be reused on next install)"
    fi
fi

echo "  Cleaned ✓"

echo ""
echo "=== Uninstall complete ==="
echo ""
echo "To reinstall: ./install.sh"
