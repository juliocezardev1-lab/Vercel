const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const config = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

test('Vercel routes friendly login URLs to the HTML frontend', () => {
    const routes = new Map(config.rewrites.map(({ source, destination }) => [source, destination]));
    assert.equal(routes.get('/login'), '/login.html');
    assert.equal(routes.get('/login/'), '/login.html');
    assert.equal(routes.get('/'), '/api/index');
    assert.equal(routes.get('/index.html'), '/api/index');
    assert.equal(config.outputDirectory, 'FRONTEND');
    assert.equal(fs.existsSync(path.join(root, 'FRONTEND/login.html')), true);
});

test('CSP retains Cloudflare Turnstile and secure default restrictions', () => {
    const csp = config.headers.flatMap((rule) => rule.headers).find((h) => h.key.toLowerCase() === 'content-security-policy')?.value;
    assert.ok(csp);
    assert.match(csp, /script-src[^;]*https:\/\/challenges\.cloudflare\.com/);
    assert.match(csp, /frame-src[^;]*https:\/\/challenges\.cloudflare\.com/);
    assert.match(csp, /object-src 'none'/);
    assert.doesNotMatch(csp, /script-src[^;]*'unsafe-inline'/);
});

test('Frontend assets and login redirect work for /login and /login/', () => {
    const loginHtml = read('FRONTEND/login.html');
    assert.match(loginHtml, /href="\/style\.css"/);
    assert.match(loginHtml, /src="\/login\.js"/);
    assert.match(loginHtml, /Cadastro de Produtos/);
    assert.doesNotMatch(loginHtml, /Tech Take/i);
    assert.match(read('FRONTEND/script.js'), /window\.location\.replace\('\/login'\)/);
    assert.match(read('BACKEND/server.js'), /res\.redirect\(303, '\/login'\)/);
});

test('Login remains protected by server-side Turnstile verification', () => {
    const backend = read('BACKEND/server.js');
    const helpers = read('BACKEND/auth.js');
    assert.match(backend, /auth\.verifyTurnstile/);
    assert.match(helpers, /siteverify/);
    assert.match(helpers, /payload\.hostname/);
    assert.match(helpers, /payload\.action/);
    assert.match(backend, /requireSameOrigin/);
});
