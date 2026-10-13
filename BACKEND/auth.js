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
    return password.length >= 8 && password.length <= 128;
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

async function verifyTurnstile({ secretKey, responseToken, remoteIp, fetchImpl = globalThis.fetch }) {
    if (!secretKey || !responseToken) {
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
            })
        });

        if (!response.ok) {
            return { success: false, error: 'captcha_provider_unavailable' };
        }

        const payload = await response.json();
        return {
            success: Boolean(payload.success),
            error: payload.success ? undefined : (payload['error-codes'] && payload['error-codes'][0]) || 'captcha_invalid'
        };
    } catch (erro) {
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
