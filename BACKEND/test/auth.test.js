const assert = require('node:assert/strict');
const http = require('node:http');
const { after, before, test } = require('node:test');
const auth = require('../auth');
const database = require('../database');

process.env.VERCEL = '1';
process.env.TURNSTILE_SITE_KEY = 'test-site-key';
process.env.TURNSTILE_SECRET_KEY = 'test-secret-key';
process.env.TURNSTILE_EXPECTED_HOSTNAME = 'localhost';
process.env.RATE_LIMIT_SECRET = 'test-only-rate-limit-secret';

const user = {
    id: 7,
    identifier: 'admin@example.test',
    password_hash: '',
    role: 'admin',
    is_active: true
};
const sessions = new Map();
const attempts = new Map();
const usedTurnstileTokens = new Set();
let turnstilePayload = { success: true, hostname: 'localhost', action: 'login' };
let turnstileCalls = 0;

database.query = async (sql, parameters = []) => {
    const statement = sql.replace(/\s+/g, ' ').trim();

    if (statement.startsWith('DELETE FROM public.login_attempts') &&
        !statement.includes('ANY($1::text[])')) {
        return { rows: [], rowCount: 0 };
    }
    if (statement.startsWith('INSERT INTO public.login_attempts')) {
        const [bucket, windowMinutes, maxAttempts] = parameters;
        const current = attempts.get(bucket) || { count: 0, blockedUntil: 0 };
        current.count += 1;
        if (current.count > maxAttempts && !current.blockedUntil) {
            current.blockedUntil = Date.now() + windowMinutes * 60 * 1000;
        }
        attempts.set(bucket, current);
        return { rows: [{ blocked: current.blockedUntil > Date.now() }], rowCount: 1 };
    }
    if (statement.startsWith('SELECT id, identifier, password_hash, role FROM public.auth_users')) {
        return {
            rows: user.is_active && parameters[0] === user.identifier ? [user] : [],
            rowCount: user.is_active && parameters[0] === user.identifier ? 1 : 0
        };
    }
    if (statement.startsWith('SELECT u.id, u.identifier, u.role FROM public.auth_sessions')) {
        const session = sessions.get(parameters[0]);
        if (!session || session.expiresAt <= Date.now() || !user.is_active) {
            return { rows: [], rowCount: 0 };
        }
        return {
            rows: [{ id: user.id, identifier: user.identifier, role: user.role }],
            rowCount: 1
        };
    }
    if (statement.startsWith('INSERT INTO public.auth_sessions')) {
        sessions.set(parameters[0], { userId: parameters[1], expiresAt: Date.now() + parameters[2] * 1000 });
        return { rows: [], rowCount: 1 };
    }
    if (statement.startsWith('DELETE FROM public.auth_sessions WHERE token_hash = $1')) {
        return { rows: [], rowCount: sessions.delete(parameters[0]) ? 1 : 0 };
    }
    if (statement.startsWith('DELETE FROM public.auth_sessions')) {
        return { rows: [], rowCount: 0 };
    }
    if (statement.startsWith('DELETE FROM public.login_attempts WHERE bucket_hash = ANY')) {
        for (const bucket of parameters[0]) attempts.delete(bucket);
        return { rows: [], rowCount: parameters[0].length };
    }
    if (statement.startsWith('SELECT * FROM public.produtos')) {
        return { rows: [{ id: 1, nome: 'Produto de teste', preco: 1, quantidade: 1 }], rowCount: 1 };
    }
    if (statement.startsWith('INSERT INTO public.produtos')) {
        return {
            rows: [{ id: 2, nome: parameters[0], preco: parameters[1], quantidade: parameters[2] }],
            rowCount: 1
        };
    }
    if (statement.startsWith('DELETE FROM public.produtos')) {
        return { rows: [], rowCount: 1 };
    }

    throw new Error(`Unexpected test database query: ${statement}`);
};

const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, options) => {
    if (url !== 'https://challenges.cloudflare.com/turnstile/v0/siteverify') {
        throw new Error('Unexpected external request in test');
    }
    turnstileCalls += 1;
    const token = JSON.parse(options.body).response;
    if (usedTurnstileTokens.has(token)) {
        return {
            ok: true,
            json: async () => ({ success: false, 'error-codes': ['timeout-or-duplicate'] })
        };
    }
    usedTurnstileTokens.add(token);
    return { ok: true, json: async () => turnstilePayload };
};

let server;
let baseUrl;
let app;

function request(path, { method = 'GET', body, headers = {} } = {}) {
    return new Promise((resolve, reject) => {
        const url = new URL(path, baseUrl);
        const requestHeaders = { ...headers };
        let payload;
        if (body !== undefined) {
            payload = JSON.stringify(body);
            requestHeaders['Content-Type'] = 'application/json';
            requestHeaders['Content-Length'] = Buffer.byteLength(payload);
        }
        const clientRequest = http.request(url, { method, headers: requestHeaders }, (response) => {
            const chunks = [];
            response.on('data', (chunk) => chunks.push(chunk));
            response.on('end', () => {
                const text = Buffer.concat(chunks).toString();
                let data;
                try {
                    data = text ? JSON.parse(text) : undefined;
                } catch {
                    data = text;
                }
                resolve({ status: response.statusCode, headers: response.headers, data });
            });
        });
        clientRequest.on('error', reject);
        if (payload) clientRequest.write(payload);
        clientRequest.end();
    });
}

before(async () => {
    user.password_hash = await auth.hashPassword('Correct-Horse!Battery9');
    app = require('../server');
    server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
    globalThis.fetch = originalFetch;
    await new Promise((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
    });
});

test('authentication helpers normalize identifiers and validate Turnstile metadata', async () => {
    assert.equal(auth.normalizeIdentifier(' ADMIN@Example.Test '), 'admin@example.test');
    assert.equal(auth.isValidIdentifier('admin@example.test'), true);
    assert.equal(auth.isValidPassword('short'), false);
    assert.equal(auth.isValidPassword('Correct-Horse!Battery9'), true);

    const wrongHostname = await auth.verifyTurnstile({
        secretKey: 'test-secret',
        responseToken: 'token',
        expectedHostname: 'expected.test',
        fetchImpl: async () => ({
            ok: true,
            json: async () => ({ success: true, hostname: 'other.test', action: 'login' })
        })
    });
    assert.deepEqual(wrongHostname, { success: false, error: 'captcha_invalid' });

    const wrongAction = await auth.verifyTurnstile({
        secretKey: 'test-secret',
        responseToken: 'token',
        expectedHostname: 'localhost',
        fetchImpl: async () => ({
            ok: true,
            json: async () => ({ success: true, hostname: 'localhost', action: 'signup' })
        })
    });
    assert.deepEqual(wrongAction, { success: false, error: 'captcha_invalid' });

    const timeout = await auth.verifyTurnstile({
        secretKey: 'test-secret',
        responseToken: 'token',
        expectedHostname: 'localhost',
        fetchImpl: async () => { throw new Error('provider unavailable'); }
    });
    assert.deepEqual(timeout, { success: false, error: 'captcha_provider_unavailable' });

    const providerError = await auth.verifyTurnstile({
        secretKey: 'test-secret',
        responseToken: 'token',
        expectedHostname: 'localhost',
        fetchImpl: async () => ({ ok: false })
    });
    assert.deepEqual(providerError, { success: false, error: 'captcha_provider_unavailable' });

    const malformedResponse = await auth.verifyTurnstile({
        secretKey: 'test-secret',
        responseToken: 'token',
        expectedHostname: 'localhost',
        fetchImpl: async () => ({ ok: true, json: async () => null })
    });
    assert.deepEqual(malformedResponse, { success: false, error: 'captcha_provider_unavailable' });
});

test('login, protected inventory APIs, session expiry, logout, CSRF and rate limiting', async () => {
    const config = await request('/api/config');
    assert.equal(config.status, 200);
    assert.deepEqual(config.data, { turnstileSiteKey: 'test-site-key' });

    const dashboardRedirect = await request('/');
    assert.equal(dashboardRedirect.status, 303);
    assert.equal(dashboardRedirect.headers.location, '/login');
    const directDashboardRedirect = await request('/index.html');
    assert.equal(directDashboardRedirect.status, 303);
    const loginPage = await request('/login.html');
    assert.equal(loginPage.status, 200);
    const cleanLoginPage = await request('/login');
    assert.equal(cleanLoginPage.status, 200);
    assert.match(cleanLoginPage.data, /Cadastro de Produtos/);
    const trailingSlashLoginPage = await request('/login/');
    assert.equal(trailingSlashLoginPage.status, 200);

    for (const [method, route] of [
        ['GET', '/produtos'],
        ['POST', '/produtos'],
        ['DELETE', '/produtos'],
        ['DELETE', '/produtos/1']
    ]) {
        const headers = method === 'GET' ? {} : { Origin: new URL(baseUrl).origin };
        const response = await request(route, { method, headers });
        assert.equal(response.status, 401, `${method} ${route} requires an admin session`);
    }

    const crossOrigin = await request('/api/login', {
        method: 'POST',
        headers: { Origin: 'https://attacker.example' },
        body: { identifier: user.identifier, password: 'Correct-Horse!Battery9', cfTurnstileToken: 'invalid-captcha-token' }
    });
    assert.equal(crossOrigin.status, 403);

    const missingToken = await request('/api/login', {
        method: 'POST',
        headers: { Origin: new URL(baseUrl).origin },
        body: { identifier: user.identifier, password: 'Correct-Horse!Battery9' }
    });
    assert.equal(missingToken.status, 400);

    const emptyFields = await request('/api/login', {
        method: 'POST',
        headers: { Origin: new URL(baseUrl).origin },
        body: { identifier: '', password: '' }
    });
    assert.equal(emptyFields.status, 400);

    turnstilePayload = { success: true, hostname: 'attacker.example', action: 'login' };
    const invalidCaptcha = await request('/api/login', {
        method: 'POST',
        headers: { Origin: new URL(baseUrl).origin },
        body: { identifier: user.identifier, password: 'Correct-Horse!Battery9', cfTurnstileToken: 'token' }
    });
    assert.equal(invalidCaptcha.status, 400);
    assert.equal(invalidCaptcha.data.error, 'Verificação inválida. Tente novamente.');

    turnstilePayload = { success: true, hostname: 'localhost', action: 'login' };
    const wrongPassword = await request('/api/login', {
        method: 'POST',
        headers: { Origin: new URL(baseUrl).origin },
        body: { identifier: user.identifier, password: 'Wrong-password-123!', cfTurnstileToken: 'wrong-password-token' }
    });
    assert.equal(wrongPassword.status, 401);
    assert.equal(wrongPassword.data.error, 'Credenciais inválidas.');

    const replayedToken = await request('/api/login', {
        method: 'POST',
        headers: { Origin: new URL(baseUrl).origin },
        body: { identifier: user.identifier, password: 'Correct-Horse!Battery9', cfTurnstileToken: 'wrong-password-token' }
    });
    assert.equal(replayedToken.status, 400);

    const unknownUser = await request('/api/login', {
        method: 'POST',
        headers: { Origin: new URL(baseUrl).origin },
        body: { identifier: 'missing@example.test', password: 'Correct-Horse!Battery9', cfTurnstileToken: 'unknown-user-token' }
    });
    assert.equal(unknownUser.status, 401);
    assert.equal(unknownUser.data.error, wrongPassword.data.error);

    const login = await request('/api/login', {
        method: 'POST',
        headers: { Origin: new URL(baseUrl).origin },
        body: { identifier: user.identifier, password: 'Correct-Horse!Battery9', cfTurnstileToken: 'fresh-token' }
    });
    assert.equal(login.status, 200);
    assert.equal(login.data.redirect, '/');
    assert.match(login.headers['set-cookie'][0], /HttpOnly/);
    assert.match(login.headers['set-cookie'][0], /Secure/);
    assert.match(login.headers['set-cookie'][0], /SameSite=Strict/);
    assert.match(login.headers['set-cookie'][0], /Path=\//);
    assert.equal(login.headers['cache-control'], 'no-store');

    const cookiePair = login.headers['set-cookie'][0].split(';', 1)[0];
    const token = cookiePair.slice(cookiePair.indexOf('=') + 1);
    const tokenHash = auth.hashToken(token);
    assert.equal(sessions.has(tokenHash), true);

    const session = await request('/api/session', { headers: { Cookie: cookiePair } });
    assert.equal(session.status, 200);
    assert.deepEqual(session.data.user, {
        id: user.id,
        identifier: user.identifier,
        role: 'admin'
    });
    const concurrentSessions = await Promise.all([
        request('/api/session', { headers: { Cookie: cookiePair } }),
        request('/api/session', { headers: { Cookie: cookiePair } })
    ]);
    assert.deepEqual(concurrentSessions.map((response) => response.status), [200, 200]);
    const authenticatedDashboard = await request('/', { headers: { Cookie: cookiePair } });
    assert.equal(authenticatedDashboard.status, 200);
    assert.match(authenticatedDashboard.headers['content-type'], /text\/html/);

    const products = await request('/produtos', { headers: { Cookie: cookiePair } });
    assert.equal(products.status, 200);
    assert.equal(products.data[0].nome, 'Produto de teste');

    const createdProduct = await request('/produtos', {
        method: 'POST',
        headers: { Cookie: cookiePair, Origin: new URL(baseUrl).origin },
        body: { nome: 'Produto protegido', preco: 25.5, quantidade: 3 }
    });
    assert.equal(createdProduct.status, 201);
    assert.equal(createdProduct.data.nome, 'Produto protegido');

    const invalidProduct = await request('/produtos', {
        method: 'POST',
        headers: { Cookie: cookiePair, Origin: new URL(baseUrl).origin },
        body: { nome: '', preco: 0, quantidade: 1 }
    });
    assert.equal(invalidProduct.status, 400);

    const deletedProduct = await request('/produtos/1', {
        method: 'DELETE',
        headers: { Cookie: cookiePair, Origin: new URL(baseUrl).origin }
    });
    assert.equal(deletedProduct.status, 204);

    const clearedProducts = await request('/produtos', {
        method: 'DELETE',
        headers: { Cookie: cookiePair, Origin: new URL(baseUrl).origin }
    });
    assert.equal(clearedProducts.status, 204);

    const crossOriginDelete = await request('/produtos', {
        method: 'DELETE',
        headers: { Cookie: cookiePair, Origin: 'https://attacker.example' }
    });
    assert.equal(crossOriginDelete.status, 403);

    sessions.get(tokenHash).expiresAt = Date.now() - 1;
    const expiredSession = await request('/api/session', { headers: { Cookie: cookiePair } });
    assert.equal(expiredSession.status, 401);

    const secondLogin = await request('/api/login', {
        method: 'POST',
        headers: { Origin: new URL(baseUrl).origin, Cookie: cookiePair },
        body: { identifier: user.identifier, password: 'Correct-Horse!Battery9', cfTurnstileToken: 'fresh-token-2' }
    });
    assert.equal(secondLogin.status, 200);
    const secondCookie = secondLogin.headers['set-cookie'][0].split(';', 1)[0];
    assert.equal(sessions.has(tokenHash), false);

    const logout = await request('/api/logout', {
        method: 'POST',
        headers: { Origin: new URL(baseUrl).origin, Cookie: secondCookie }
    });
    assert.equal(logout.status, 204);
    assert.match(logout.headers['set-cookie'][0], /Expires=Thu, 01 Jan 1970/);
    const afterLogout = await request('/api/session', { headers: { Cookie: secondCookie } });
    assert.equal(afterLogout.status, 401);

    let blockedResponse;
    for (let attempt = 0; attempt < 9; attempt += 1) {
        blockedResponse = await request('/api/login', {
            method: 'POST',
            headers: { Origin: new URL(baseUrl).origin },
            body: { identifier: user.identifier, password: 'Correct-Horse!Battery9', cfTurnstileToken: 'fresh-token' }
        });
        if (attempt < 8) assert.equal(blockedResponse.status, 400);
    }
    assert.equal(blockedResponse.status, 429);
    assert.equal(turnstileCalls >= 2, true);
});
