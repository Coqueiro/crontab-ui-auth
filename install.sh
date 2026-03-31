#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="$SCRIPT_DIR/.env"

echo "=== crontab-ui installer ==="
echo ""

# 1. Check prerequisites
echo "[1/5] Checking prerequisites..."
for cmd in node npm sudo; do
    if ! command -v "$cmd" &>/dev/null; then
        echo "ERROR: '$cmd' is required but not found."
        exit 1
    fi
done
echo "  node $(node -v), npm $(npm -v) ✓"

# 2. Install crontab-ui globally
echo ""
echo "[2/5] Installing crontab-ui..."
if command -v crontab-ui &>/dev/null; then
    echo "  crontab-ui already installed, skipping."
else
    sudo env "PATH=$PATH" npm install -g crontab-ui
    echo "  crontab-ui installed ✓"
fi

# 3. Patch cron-parser v5 compatibility
echo ""
echo "[3/5] Patching cron-parser v5 compatibility..."
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
    sudo sed -i 's/^var cron_parser = require("cron-parser");/var cron_parser = require("cron-parser");\nvar CronExpressionParser = cron_parser.CronExpressionParser;/' "$CRONTAB_JS"
    sudo sed -i 's/cron_parser\.parseExpression(/CronExpressionParser.parse(/g' "$CRONTAB_JS"
    sudo sed -i "s/is_valid = cron_parser.parseString(line).expressions.length > 0;/is_valid = !!CronExpressionParser.parse(schedule);/" "$CRONTAB_JS"
    echo "  Patched ✓"
fi

# 4. Install auth proxy dependencies
echo ""
echo "[4/5] Installing auth proxy dependencies..."
npm install --prefix "$SCRIPT_DIR" express http-proxy-middleware cookie-session bcryptjs express-rate-limit 2>&1 | tail -1
echo "  Dependencies installed ✓"

# 5. Configure password and session secret
echo ""
echo "[5/5] Configuring authentication..."
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

    AUTH_PASSWORD_HASH=$(node -e "require('bcryptjs').hash('$AUTH_PASSWORD', 10).then(h => console.log(h))")
    SESSION_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")

    cat > "$ENV_FILE" << EOF
AUTH_PASSWORD_HASH='${AUTH_PASSWORD_HASH}'
SESSION_SECRET='${SESSION_SECRET}'
EOF
    chmod 600 "$ENV_FILE"
    echo "  Password configured ✓"
fi

# Make scripts executable
chmod +x "$SCRIPT_DIR/start.sh" "$SCRIPT_DIR/stop.sh"

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
