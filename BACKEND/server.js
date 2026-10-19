const express = require('express');
const path = require('path');
const crypto = require('crypto');
const db = require('./database');
const auth = require('./auth');

const app = express();
const PORT = process.env.PORT || 3000;
const SESSION_TTL_SECONDS = 8 * 60 * 60;
const LOGIN_WINDOW_MINUTES = 15;
const LOGIN_MAX_ATTEMPTS = 8;
const COOKIE_NAME = process.env.VERCEL || process.env.NODE_ENV === 'production'
    ? '__Host-auth_session'
    : 'auth_session';
const DUMMY_PASSWORD_HASH = auth.hashPassword(auth.generateToken());

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use((req, res, next) => {
    res.set({
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
        'X-Frame-Options': 'DENY',
        'Permissions-Policy': 'camera=(), microphone=(), geolocation=()'
    });
    next();
});
app.use(express.json({ limit: '10kb', strict: true }));

function sendDatabaseError(res, message, error) {
    console.error(message, error.code || 'DATABASE_ERROR');
    return res.status(503).json({ error: 'Serviço temporariamente indisponível.' });
}

function requestHasSameOrigin(req) {
    const origin = req.get('origin');
    if (!origin) return false;

    try {
        const parsed = new URL(origin);
        const host = req.get('host');
        const secureOrigin = parsed.protocol === 'https:';
        return parsed.host.toLowerCase() === String(host).toLowerCase() &&
            (secureOrigin || (process.env.NODE_ENV !== 'production' && parsed.protocol === 'http:'));
    } catch {
        return false;
    }
}

function requireSameOrigin(req, res, next) {
    if (!requestHasSameOrigin(req)) {
        return res.status(403).json({ error: 'Requisição não permitida.' });
    }
    return next();
}

function readSessionCookie(req) {
    const cookies = String(req.headers.cookie || '').split(';');
    const prefix = `${COOKIE_NAME}=`;
    const item = cookies.find((cookie) => cookie.trim().startsWith(prefix));
    if (!item) return null;

    const token = item.trim().slice(prefix.length);
    return /^[a-f0-9]{64}$/.test(token) ? token : null;
}

function setSessionCookie(res, token) {
    res.cookie(COOKIE_NAME, token, {
        httpOnly: true,
        secure: COOKIE_NAME.startsWith('__Host-'),
        sameSite: 'strict',
        path: '/',
        maxAge: SESSION_TTL_SECONDS * 1000
    });
}

function clearSessionCookie(res) {
    res.clearCookie(COOKIE_NAME, {
        httpOnly: true,
        secure: COOKIE_NAME.startsWith('__Host-'),
        sameSite: 'strict',
        path: '/'
    });
}

function getClientIp(req) {
    return req.ip || req.socket.remoteAddress || 'unknown';
}

async function reserveLoginAttempt(bucket) {
    const result = await db.query(
        `INSERT INTO public.login_attempts AS current_attempts
            (bucket_hash, window_started_at, attempts, blocked_until)
         VALUES ($1, now(), 1, NULL)
         ON CONFLICT (bucket_hash) DO UPDATE SET
            window_started_at = CASE
                WHEN current_attempts.window_started_at <= now() - ($2::int * interval '1 minute')
                THEN now()
                ELSE current_attempts.window_started_at
            END,
            attempts = CASE
                WHEN current_attempts.window_started_at <= now() - ($2::int * interval '1 minute')
                THEN 1
                ELSE current_attempts.attempts + 1
            END,
            blocked_until = CASE
                WHEN current_attempts.window_started_at <= now() - ($2::int * interval '1 minute')
                THEN NULL
                WHEN current_attempts.blocked_until > now()
                THEN current_attempts.blocked_until
                WHEN current_attempts.attempts + 1 > $3::int
                THEN now() + ($2::int * interval '1 minute')
                ELSE NULL
            END
         RETURNING blocked_until > now() AS blocked`,
        [bucket, LOGIN_WINDOW_MINUTES, LOGIN_MAX_ATTEMPTS]
    );
    return result.rows[0]?.blocked === true;
}

function hashRateLimitBucket(value) {
    const secret = process.env.RATE_LIMIT_SECRET;
    if (!secret) {
        throw new Error('RATE_LIMIT_SECRET is not configured.');
    }
    return crypto.createHmac('sha256', secret).update(value).digest('hex');
}

async function reserveLoginBuckets(identifier, ip) {
    await db.query(
        `DELETE FROM public.login_attempts
         WHERE window_started_at < now() - interval '1 day'`
    );
    const buckets = [
        hashRateLimitBucket(`identifier:${identifier}`),
        hashRateLimitBucket(`ip:${ip}`)
    ];
    for (const bucket of buckets) {
        if (await reserveLoginAttempt(bucket)) return true;
    }
    return false;
}

async function clearLoginBuckets(identifier, ip) {
    const buckets = [
        hashRateLimitBucket(`identifier:${identifier}`),
        hashRateLimitBucket(`ip:${ip}`)
    ];
    await db.query(
        'DELETE FROM public.login_attempts WHERE bucket_hash = ANY($1::text[])',
        [buckets]
    );
}

async function loadUserForSession(req) {
    const token = readSessionCookie(req);
    if (!token) return null;

    const result = await db.query(
        `SELECT u.id, u.identifier, u.role
         FROM public.auth_sessions AS s
         JOIN public.auth_users AS u ON u.id = s.user_id
         WHERE s.token_hash = $1 AND s.expires_at > now() AND u.is_active = TRUE`,
        [auth.hashToken(token)]
    );
    return result.rows[0] || null;
}

async function requireAdmin(req, res, next) {
    if (req.method !== 'GET' && !requestHasSameOrigin(req)) {
        return res.status(403).json({ erro: 'Requisição não permitida' });
    }

    try {
        const user = await loadUserForSession(req);
        if (!user || user.role !== 'admin') {
            return res.status(401).json({ erro: 'Autenticação necessária' });
        }
        req.authUser = user;
        return next();
    } catch (error) {
        return sendDatabaseError(res, 'Erro ao validar sessão:', error);
    }
}

async function serveDashboard(req, res) {
    try {
        const user = await loadUserForSession(req);
        if (!user || user.role !== 'admin') {
            return res.redirect(303, '/login');
        }
        return res.sendFile(path.join(__dirname, '../FRONTEND/index.html'));
    } catch (error) {
        console.error('Erro ao validar acesso ao painel:', error.code || 'DATABASE_ERROR');
        return res.status(503).send('Serviço temporariamente indisponível.');
    }
}

// Mirrors the clean /login URL used in Vercel rewrites during local development.
app.get(['/login', '/login/'], (req, res) => {
    return res.sendFile(path.join(__dirname, '../FRONTEND/login.html'));
});

app.get('/', serveDashboard);
app.get('/index.html', serveDashboard);
app.get('/api/index', serveDashboard);

app.get('/api/config', (req, res) => {
    const siteKey = process.env.TURNSTILE_SITE_KEY;
    const secretKey = process.env.TURNSTILE_SECRET_KEY;
    const expectedHostname = process.env.TURNSTILE_EXPECTED_HOSTNAME;
    const rateLimitSecret = process.env.RATE_LIMIT_SECRET;
    if (!siteKey || !secretKey || !expectedHostname || !rateLimitSecret) {
        return res.status(503).json({ error: 'Login temporariamente indisponível.' });
    }
    return res.json({ turnstileSiteKey: siteKey });
});

app.post('/api/login', requireSameOrigin, async (req, res) => {
    const body = req.body || {};
    const identifier = auth.normalizeIdentifier(body.identifier);
    const password = body.password;
    const responseToken = body.cfTurnstileToken;

    if (
        typeof body.identifier !== 'string' ||
        !auth.isValidIdentifier(identifier) ||
        typeof password !== 'string' ||
        password.length < 12 ||
        Buffer.byteLength(password, 'utf8') > 72 ||
        typeof responseToken !== 'string' ||
        responseToken.length === 0 ||
        responseToken.length > 2048
    ) {
        return res.status(400).json({ error: 'Informe credenciais e verificação válidas.' });
    }

    const clientIp = getClientIp(req);
    if (!process.env.RATE_LIMIT_SECRET) {
        return res.status(503).json({ error: 'Login temporariamente indisponível.' });
    }
    try {
        if (await reserveLoginBuckets(identifier, clientIp)) {
            return res.status(429).json({ error: 'Muitas tentativas. Tente novamente em alguns minutos.' });
        }
    } catch (error) {
        return sendDatabaseError(res, 'Erro ao aplicar limite de login:', error);
    }

    const secretKey = process.env.TURNSTILE_SECRET_KEY;
    const expectedHostname = process.env.TURNSTILE_EXPECTED_HOSTNAME;
    if (!secretKey || !expectedHostname) {
        return res.status(503).json({ error: 'Login temporariamente indisponível.' });
    }

    const captcha = await auth.verifyTurnstile({
        secretKey,
        responseToken,
        remoteIp: clientIp,
        expectedHostname
    });
    if (!captcha.success) {
        if (captcha.error === 'captcha_provider_unavailable') {
            console.warn('Falha na verificação Turnstile:', 'PROVIDER_UNAVAILABLE');
            return res.status(503).json({ error: 'Verificação temporariamente indisponível.' });
        }
        console.warn('Falha na verificação Turnstile:', 'INVALID_TOKEN');
        return res.status(400).json({ error: 'Verificação inválida. Tente novamente.' });
    }

    try {
        const result = await db.query(
            `SELECT id, identifier, password_hash, role
             FROM public.auth_users
             WHERE identifier = $1 AND is_active = TRUE`,
            [identifier]
        );
        const user = result.rows[0];
        const passwordHash = user ? user.password_hash : await DUMMY_PASSWORD_HASH;
        const passwordMatches = await auth.verifyPassword(password, passwordHash);

        if (!user || user.role !== 'admin' || !passwordMatches) {
            console.warn('Falha de autenticação:', 'INVALID_CREDENTIALS');
            return res.status(401).json({ error: 'Credenciais inválidas.' });
        }

        const oldToken = readSessionCookie(req);
        if (oldToken) {
            await db.query(
                'DELETE FROM public.auth_sessions WHERE token_hash = $1',
                [auth.hashToken(oldToken)]
            );
        }

        await db.query(
            `DELETE FROM public.auth_sessions
             WHERE expires_at < now() - interval '1 day'`
        );
        await clearLoginBuckets(identifier, clientIp);

        const token = auth.generateToken();
        await db.query(
            `INSERT INTO public.auth_sessions (token_hash, user_id, expires_at)
             VALUES ($1, $2, now() + ($3::int * interval '1 second'))`,
            [auth.hashToken(token), user.id, SESSION_TTL_SECONDS]
        );
        setSessionCookie(res, token);
        return res.status(200).json({ redirect: '/' });
    } catch (error) {
        return sendDatabaseError(res, 'Erro ao autenticar usuário:', error);
    }
});

app.get('/api/session', async (req, res) => {
    try {
        const user = await loadUserForSession(req);
        if (!user || user.role !== 'admin') {
            return res.status(401).json({ error: 'Autenticação necessária.' });
        }
        return res.json({ user: { id: user.id, identifier: user.identifier, role: user.role } });
    } catch (error) {
        return sendDatabaseError(res, 'Erro ao consultar sessão:', error);
    }
});

app.post('/api/logout', requireSameOrigin, async (req, res) => {
    const token = readSessionCookie(req);
    try {
        if (token) {
            await db.query(
                'DELETE FROM public.auth_sessions WHERE token_hash = $1',
                [auth.hashToken(token)]
            );
        }
        clearSessionCookie(res);
        return res.status(204).send();
    } catch (error) {
        return sendDatabaseError(res, 'Erro ao encerrar sessão:', error);
    }
});

app.use('/produtos', requireAdmin);

app.get('/produtos', async (req, res) => {
    try {
        const resultado = await db.query('SELECT * FROM public.produtos ORDER BY id');
        res.status(200).json(resultado.rows);
    } catch (erro) {
        return sendDatabaseError(res, 'Erro ao buscar produtos:', erro);
    }
});

app.post('/produtos', async (req, res) => {
    const { nome, preco, quantidade } = req.body || {};
    const p = Number(preco);
    const q = Number(quantidade);

    if (
        typeof nome !== 'string' ||
        !nome.trim() ||
        nome.trim().length > 200 ||
        !Number.isFinite(p) ||
        !Number.isSafeInteger(q) ||
        p <= 0 ||
        q <= 0
    ) {
        return res.status(400).json({ erro: 'Dados inválidos enviados para o servidor' });
    }

    try {
        const resultado = await db.query(
            `INSERT INTO public.produtos (nome, preco, quantidade)
             VALUES ($1, $2, $3)
             RETURNING id, nome, preco, quantidade`,
            [nome.trim(), p, q]
        );
        return res.status(201).json(resultado.rows[0]);
    } catch (erro) {
        return sendDatabaseError(res, 'Erro ao cadastrar produto:', erro);
    }
});

app.delete('/produtos', async (req, res) => {
    try {
        await db.query('DELETE FROM public.produtos');
        return res.status(204).send();
    } catch (erro) {
        return sendDatabaseError(res, 'Erro ao limpar produtos:', erro);
    }
});

app.delete('/produtos/:id', async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id <= 0) {
        return res.status(400).json({ erro: 'ID inválido' });
    }

    try {
        const resultado = await db.query(
            'DELETE FROM public.produtos WHERE id = $1',
            [id]
        );
        if (resultado.rowCount === 0) {
            return res.status(404).json({ erro: 'Produto não encontrado' });
        }
        return res.status(204).send();
    } catch (erro) {
        return sendDatabaseError(res, 'Erro ao apagar produto:', erro);
    }
});

app.use(express.static(path.join(__dirname, '../FRONTEND'), { index: false }));

app.use((error, req, res, next) => {
    if (error instanceof SyntaxError && error.status === 400 && 'body' in error) {
        return res.status(400).json({ error: 'Corpo da requisição inválido.' });
    }
    if (error.type === 'entity.too.large') {
        return res.status(413).json({ error: 'Corpo da requisição muito grande.' });
    }
    console.error('Erro na requisição:', error.code || 'REQUEST_ERROR');
    return res.status(500).json({ error: 'Erro interno do servidor.' });
});

if (require.main === module && !process.env.VERCEL) {
    db.inicializar()
        .then(() => {
            app.listen(PORT, () => {
                console.log(`Servidor backend rodando em http://localhost:${PORT}`);
            });
        })
        .catch(async (erro) => {
            console.error('Erro ao iniciar o banco de dados:', erro.code || 'DATABASE_ERROR');
            await db.encerrar();
            process.exitCode = 1;
        });
}

module.exports = app;
