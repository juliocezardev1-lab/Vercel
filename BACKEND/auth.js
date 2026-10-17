const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const HASH_ROUNDS = 12;

function normalizeIdentifier(value = '') {
    return String(value).trim().toLowerCase();
}

function isValidIdentifier(value = '') {
    const normalized = normalizeIdentifier(value);
    return normalized.length >= 3 && normalized.length <= 100 && /^[a-z0-9._@-]+$/.test(normalized);
}

function isValidPassword(value = '') {
    const password = String(value);
    return password.length >= 12 && Buffer.byteLength(password, 'utf8') <= 72;
}

function generateToken(bytes = 32) {
    return crypto.randomBytes(bytes).toString('hex');
}

function hashToken(value) {
    return crypto.createHash('sha256').update(String(value)).digest('hex');
}

async function hashPassword(password) {
    return bcrypt.hash(password, HASH_ROUNDS);
}

async function verifyPassword(password, passwordHash) {
    if (!passwordHash) {
        return false;
    }

    return bcrypt.compare(password, passwordHash);
}

async function verifyTurnstile({
    secretKey,
    responseToken,
    remoteIp,
    expectedHostname,
    expectedAction = 'login',
    fetchImpl = globalThis.fetch
}) {
    if (!secretKey || !responseToken || !expectedHostname) {
        return { success: false, error: 'captcha_missing' };
    }

    try {
        const response = await fetchImpl('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                secret: secretKey,
                response: responseToken,
                remoteip: remoteIp || undefined
            }),
            signal: AbortSignal.timeout(5000)
        });

        if (!response.ok) {
            return { success: false, error: 'captcha_provider_unavailable' };
        }

        const payload = await response.json();
        if (!payload || typeof payload !== 'object') {
            return { success: false, error: 'captcha_provider_unavailable' };
        }

        if (!payload.success) {
            return {
                success: false,
                error: (payload['error-codes'] && payload['error-codes'][0]) || 'captcha_invalid'
            };
        }

        if (
            typeof payload.hostname !== 'string' ||
            payload.hostname.toLowerCase() !== expectedHostname.toLowerCase() ||
            payload.action !== expectedAction
        ) {
            return { success: false, error: 'captcha_invalid' };
        }

        return {
            success: true
        };
    } catch {
        return { success: false, error: 'captcha_provider_unavailable' };
    }
}

module.exports = {
    normalizeIdentifier,
    isValidIdentifier,
    isValidPassword,
    generateToken,
    hashToken,
    hashPassword,
    verifyPassword,
    verifyTurnstile
};
