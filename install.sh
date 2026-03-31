#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="$SCRIPT_DIR/.env"

echo "=== crontab-ui installer ==="
echo ""

# 1. Check prerequisites
echo "[1/9] Checking prerequisites..."
for cmd in node npm sudo; do
    if ! command -v "$cmd" &>/dev/null; then
        echo "ERROR: '$cmd' is required but not found."
        exit 1
    fi
done
echo "  node $(node -v), npm $(npm -v) ✓"

# 2. Install crontab-ui globally
echo ""
echo "[2/9] Installing crontab-ui..."
if command -v crontab-ui &>/dev/null; then
    echo "  crontab-ui already installed, skipping."
else
    sudo env "PATH=$PATH" npm install -g crontab-ui
    echo "  crontab-ui installed ✓"
fi

# 3. Patch cron-parser v5 compatibility
echo ""
echo "[3/9] Patching cron-parser v5 compatibility..."
CRONTAB_JS="$(npm root -g)/crontab-ui/crontab.js"
if [[ ! -f "$CRONTAB_JS" ]]; then
    # npm root -g may differ under sudo
    CRONTAB_JS="$(sudo env "PATH=$PATH" npm root -g)/crontab-ui/crontab.js"
fi
if [[ ! -f "$CRONTAB_JS" ]]; then
    echo "  ERROR: Could not find crontab.js. Looked in $(npm root -g)/crontab-ui/"
    exit 1
fi
if grep -q 'CronExpressionParser' "$CRONTAB_JS" 2>/dev/null; then
    echo "  Already patched, skipping."
else
    # Use node for patching (cross-platform, handles multi-line replacements)
    sudo node -e "
      var fs = require('fs');
      var f = process.argv[1];
      var s = fs.readFileSync(f, 'utf8');
      s = s.replace(
        'var cron_parser = require(\"cron-parser\");',
        'var cron_parser = require(\"cron-parser\");\nvar CronExpressionParser = cron_parser.CronExpressionParser;'
      );
      s = s.replace(/cron_parser\.parseExpression\(/g, 'CronExpressionParser.parse(');
      s = s.replace(
        'is_valid = cron_parser.parseString(line).expressions.length > 0;',
        'is_valid = !!CronExpressionParser.parse(schedule);'
      );
      fs.writeFileSync(f, s);
    " "$CRONTAB_JS"
    echo "  Patched ✓"
fi

CRONTAB_UI_DIR="$(dirname "$CRONTAB_JS")"

# 4. Fix async DB race conditions (responses before writes complete)
echo ""
echo "[4/9] Patching async DB operations..."
sudo env "PATH=$PATH" node "$SCRIPT_DIR/fix-async-db.js" "$CRONTAB_UI_DIR"

# 5. Patch import_crontab to unwrap wrapped commands
echo ""
echo "[5/9] Patching import_crontab for wrapped command unwrapping..."
# fix-import.js is idempotent: checks for unwrap_command before patching
sudo env "PATH=$PATH" node "$SCRIPT_DIR/fix-import.js" "$CRONTAB_UI_DIR"

# 6. Patch NeDB for Node.js v23+ compatibility (util.isDate/isArray/isRegExp removed)
echo ""
echo "[6/9] Patching NeDB for Node.js compatibility..."

if [[ ! -d "$CRONTAB_UI_DIR/node_modules/nedb/lib" ]]; then
    echo "  WARNING: Could not find nedb lib directory, skipping."
else
    # fix-nedb.js is idempotent: removes old broken patches, prepends clean IIFE polyfill
    sudo env "PATH=$PATH" node "$SCRIPT_DIR/fix-nedb.js" "$CRONTAB_UI_DIR"
fi

# 7. Install auth proxy dependencies
echo ""
echo "[7/9] Installing auth proxy dependencies..."
npm install --prefix "$SCRIPT_DIR" express http-proxy-middleware cookie-session bcryptjs express-rate-limit 2>&1 | tail -3
echo "  Dependencies installed ✓"

# 8. Configure password and session secret
echo ""
echo "[8/9] Configuring authentication..."
if [[ -f "$ENV_FILE" ]]; then
    echo "  $ENV_FILE already exists, skipping."
    echo "  To reset password, delete $ENV_FILE and re-run install.sh"
else
    echo ""
    read -s -p "  Choose a password for crontab-ui: " AUTH_PASSWORD
    echo ""
    read -s -p "  Confirm password: " AUTH_PASSWORD_CONFIRM
    echo ""

    if [[ "$AUTH_PASSWORD" != "$AUTH_PASSWORD_CONFIRM" ]]; then
        echo "  ERROR: Passwords do not match."
        exit 1
    fi

    if [[ -z "$AUTH_PASSWORD" ]]; then
        echo "  ERROR: Password cannot be empty."
        exit 1
    fi

    AUTH_PASSWORD_HASH=$(printf '%s' "$AUTH_PASSWORD" | node -e "
      let d=''; process.stdin.on('data',c=>d+=c);
      process.stdin.on('end',()=>require('bcryptjs').hash(d,10).then(h=>console.log(h)));
    ")
    SESSION_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")

    cat > "$ENV_FILE" << EOF
AUTH_PASSWORD_HASH='${AUTH_PASSWORD_HASH}'
SESSION_SECRET='${SESSION_SECRET}'
EOF
    chmod 600 "$ENV_FILE"
    echo "  Password configured ✓"
fi

# Make scripts executable
chmod +x "$SCRIPT_DIR/start.sh" "$SCRIPT_DIR/stop.sh" "$SCRIPT_DIR/uninstall.sh"

# 9. Set up auto-start on boot
echo ""
read -p "[9/9] Start crontab-ui automatically on boot? (Y/n): " AUTOSTART
if [[ "${AUTOSTART:-y}" =~ ^[Nn]$ ]]; then
    echo "  Skipped. Run ./start.sh manually to start crontab-ui."
elif [[ "$(uname)" == "Darwin" ]]; then
    # macOS: use launchd
    PLIST_NAME="com.crontab-ui.plist"
    PLIST_DIR="$HOME/Library/LaunchAgents"
    PLIST_FILE="$PLIST_DIR/$PLIST_NAME"
    mkdir -p "$PLIST_DIR"

    cat > "$PLIST_FILE" << PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.crontab-ui</string>
    <key>ProgramArguments</key>
    <array>
        <string>${SCRIPT_DIR}/start.sh</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>StandardOutPath</key>
    <string>${SCRIPT_DIR}/launchd.log</string>
    <key>StandardErrorPath</key>
    <string>${SCRIPT_DIR}/launchd.log</string>
</dict>
</plist>
PLIST

    # Load the agent (unload first if already loaded)
    launchctl unload "$PLIST_FILE" 2>/dev/null || true
    launchctl load "$PLIST_FILE"
    echo "  launchd agent installed: $PLIST_FILE"
    echo "  crontab-ui will start automatically on login ✓"

else
    # Linux: use systemd
    SERVICE_NAME="crontab-ui"
    SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"

    sudo tee "$SERVICE_FILE" > /dev/null << SERVICE
[Unit]
Description=crontab-ui with auth proxy
After=network.target

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=${SCRIPT_DIR}/start.sh
ExecStop=${SCRIPT_DIR}/stop.sh
WorkingDirectory=${SCRIPT_DIR}

[Install]
WantedBy=multi-user.target
SERVICE

    sudo systemctl daemon-reload
    sudo systemctl enable "$SERVICE_NAME"
    sudo systemctl start "$SERVICE_NAME"
    echo "  systemd service installed: $SERVICE_FILE"
    echo "  crontab-ui will start automatically on boot ✓"
fi

# Done
echo ""
echo "=== Installation complete ==="
echo ""
echo "Usage:"
echo "  ~/crontab/start.sh                   Start crontab-ui (password protected)"
echo "  ~/crontab/stop.sh                    Stop crontab-ui"
echo "  curl localhost:8433/import_crontab   Import existing crontab entries (after login)"
echo ""
echo "Web UI: http://localhost:8433"
