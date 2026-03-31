const express = require('express');
const bcrypt = require('bcryptjs');
const cookieSession = require('cookie-session');
const rateLimit = require('express-rate-limit');
const { createProxyMiddleware } = require('http-proxy-middleware');

const PORT = parseInt(process.env.PORT || '8433', 10);
const BACKEND = process.env.BACKEND_URL || 'http://127.0.0.1:8434';
const PASSWORD_HASH = process.env.AUTH_PASSWORD_HASH;
const SESSION_SECRET = process.env.SESSION_SECRET;

if (!PASSWORD_HASH) {
  console.error('ERROR: AUTH_PASSWORD_HASH env var is required.');
  console.error('Generate one with: node -e "require(\'bcryptjs\').hash(\'yourpassword\', 10).then(console.log)"');
  process.exit(1);
}
if (!SESSION_SECRET) {
  console.error('ERROR: SESSION_SECRET env var is required.');
  console.error('Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
  process.exit(1);
}

const app = express();

app.set('trust proxy', 1);
app.use(express.urlencoded({ extended: false }));

app.use(cookieSession({
  name: 'crontab_auth',
  secret: SESSION_SECRET,
  httpOnly: true,
  sameSite: 'strict',
  maxAge: 12 * 60 * 60 * 1000, // 12 hours
}));

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: 'Too many login attempts. Try again later.',
});

const LOGIN_HTML = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>crontab-ui - Login</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
           display: flex; align-items: center; justify-content: center;
           min-height: 100vh; background: #1a1a2e; color: #e0e0e0; }
    .card { background: #16213e; border-radius: 8px; padding: 2rem;
            width: 320px; box-shadow: 0 4px 24px rgba(0,0,0,0.3); }
    h1 { font-size: 1.2rem; text-align: center; margin-bottom: 1.5rem; color: #a0c4ff; }
    input[type=password] { width: 100%; padding: 0.7rem; border: 1px solid #334;
           border-radius: 4px; background: #0f3460; color: #e0e0e0;
           font-size: 1rem; margin-bottom: 1rem; }
    input[type=password]:focus { outline: none; border-color: #a0c4ff; }
    button { width: 100%; padding: 0.7rem; border: none; border-radius: 4px;
             background: #533483; color: white; font-size: 1rem;
             cursor: pointer; transition: background 0.2s; }
    button:hover { background: #6a42a0; }
    .error { color: #ff6b6b; text-align: center; margin-bottom: 1rem; font-size: 0.9rem; }
  </style>
</head>
<body>
  <div class="card">
    <h1>crontab-ui</h1>
    {{ERROR}}
    <form method="POST" action="/login">
      <input type="password" name="password" placeholder="Password" autofocus required>
      <button type="submit">Login</button>
    </form>
  </div>
</body>
</html>`;

app.get('/login', (req, res) => {
  if (req.session && req.session.auth) return res.redirect('/');
  res.type('html').send(LOGIN_HTML.replace('{{ERROR}}', ''));
});

app.post('/login', loginLimiter, async (req, res) => {
  const ok = await bcrypt.compare(req.body.password || '', PASSWORD_HASH);
  if (!ok) {
    return res.status(401).type('html').send(
      LOGIN_HTML.replace('{{ERROR}}', '<p class="error">Invalid password</p>')
    );
  }
  req.session = { auth: true };
  res.redirect('/');
});

app.post('/logout', (req, res) => {
  req.session = null;
  res.redirect('/login');
});

// Auth gate — everything except /login requires authentication
app.use((req, res, next) => {
  if (req.path === '/login') return next();
  if (req.session && req.session.auth) return next();
  res.redirect('/login');
});

// Proxy to crontab-ui backend
app.use('/', createProxyMiddleware({
  target: BACKEND,
  changeOrigin: false,
  ws: true,
}));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Auth proxy listening on 0.0.0.0:${PORT} → ${BACKEND}`);
});
