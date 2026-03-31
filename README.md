# crontab

Authentication proxy and patch layer for [crontab-ui](https://github.com/alseambusher/crontab-ui), a web-based cron job manager.

## What this does

crontab-ui is a useful tool but ships with no authentication and has several bugs with modern Node.js versions. This project wraps it with:

- **Password-protected access** — Express reverse proxy with bcrypt authentication, cookie sessions (12h), and rate-limited login
- **Node.js v23+ compatibility** — Patches NeDB's removed `util.isDate`/`util.isArray`/`util.isRegExp` functions
- **cron-parser v5 compatibility** — Patches deprecated `parseExpression` → `CronExpressionParser.parse`
- **Import/export fix** — "Get from crontab" no longer creates duplicate entries from wrapped commands, and disables UI jobs not present in the system crontab
- **Async race condition fix** — Database operations now complete before HTTP responses are sent
- **Deterministic job IDs** — Jobs use `sha256(command + schedule)` as their ID, making duplicates structurally impossible
- **Logging enabled by default** — New jobs have logging turned on automatically

## Architecture

```
Internet → [Nginx] → 0.0.0.0:8433 (auth-proxy.js) → 127.0.0.1:8434 (crontab-ui)
```

- **auth-proxy.js** listens on port 8433 (all interfaces), handles login/session, proxies authenticated requests
- **crontab-ui** runs as root on port 8434 (localhost only), manages the system crontab

## Requirements

- Node.js (v18+, tested on v23)
- npm
- sudo access (crontab-ui edits the root crontab)

## Installation

```bash
git clone <repo-url> ~/crontab
cd ~/crontab
./install.sh
```

The installer runs 9 steps:

1. Checks prerequisites (`node`, `npm`, `sudo`)
2. Installs `crontab-ui` globally via npm
3. Patches cron-parser v5 compatibility
4. Patches async DB operations to use callbacks (fixes race conditions)
5. Patches `import_crontab` to unwrap wrapped commands and prevent duplicates
6. Patches NeDB for Node.js v23+ compatibility
7. Installs auth proxy dependencies
8. Configures password (bcrypt hash) and session secret in `.env`
9. Sets up auto-start on boot (systemd on Linux, launchd on macOS)

All patches are **idempotent** — running `install.sh` multiple times is safe.

## Usage

After installation, crontab-ui starts automatically and will restart on boot.

```bash
# Manually start/restart
./start.sh

# Stop both processes
./stop.sh

# Uninstall everything (removes auto-start, crontab entries, global package)
./uninstall.sh
```

Open `http://localhost:8433` and log in with the password you set during installation.

### Auto-start

The installer configures crontab-ui to start automatically:

- **Linux**: systemd service (`/etc/systemd/system/crontab-ui.service`), starts on boot
- **macOS**: launchd agent (`~/Library/LaunchAgents/com.crontab-ui.plist`), starts on login

To manage the service manually:

```bash
# Linux
sudo systemctl status crontab-ui
sudo systemctl restart crontab-ui

# macOS
launchctl list | grep crontab-ui
```

### Importing existing cron jobs

If you already have entries in your root crontab, click **"Get from crontab"** in the UI to import them. The patched import logic correctly handles wrapped commands, avoids creating duplicates, and **disables (stops) any UI jobs that are not present in the system crontab**. This keeps the UI in sync with the actual crontab state.

### Saving changes

After creating or editing jobs in the UI, click **"Save to crontab"** to deploy them to the actual system crontab.

## Files

| File | Purpose |
|------|---------|
| `auth-proxy.js` | Express reverse proxy with bcrypt login, cookie sessions, rate limiting |
| `install.sh` | Installer — sets up crontab-ui and applies all patches |
| `start.sh` | Starts crontab-ui (sudo, localhost:8434) + auth proxy (0.0.0.0:8433) |
| `stop.sh` | Graceful shutdown via PID files |
| `uninstall.sh` | Stops services, cleans crontab entries, uninstalls crontab-ui |
| `fix-nedb.js` | Patches NeDB for Node.js v23+ (polyfills removed `util` functions) |
| `fix-import.js` | Patches `import_crontab` to unwrap commands and deduplicate |
| `fix-async-db.js` | Patches async DB operations + deterministic IDs + default logging |
| `cleanup-duplicates.js` | Utility to remove duplicate entries from the job database |

## Security

- Passwords are hashed with bcrypt (cost factor 10, automatic salt)
- `.env` stores only the hash and session secret (chmod 600)
- Login is rate-limited (10 attempts per 15 minutes)
- crontab-ui binds to localhost only — not directly accessible from the network
- The auth proxy handles all external access

## Reverse proxy (optional)

If you want to expose crontab-ui on a domain, configure your web server to proxy to `localhost:8433`. Example for nginx:

```nginx
server {
    listen 80;
    server_name crontab.example.com;

    location / {
        proxy_pass http://127.0.0.1:8433;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

## Troubleshooting

**"Failed to start crontab-ui"** — Check `crontab-ui.log` for errors. Common cause: port 8434 already in use.

**"Failed to start auth proxy"** — Check `auth-proxy.log`. Common cause: port 8433 already in use, or `.env` missing.

**Duplicate jobs appearing** — Run `sudo node cleanup-duplicates.js` to deduplicate the job database, then click "Save to crontab" in the UI.

**Password reset** — Delete `.env` and re-run `./install.sh`. It will skip already-completed steps and prompt for a new password.
