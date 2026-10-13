const form = document.getElementById('login-form');
const identifierInput = document.getElementById('identifier');
const passwordInput = document.getElementById('password');
const toggleButton = document.getElementById('toggle-password');
const loginButton = document.getElementById('login-button');
const errorBox = document.getElementById('login-error');
const turnstileContainer = document.getElementById('turnstile-container');
let turnstileToken = '';
let turnstileWidgetId = null;

function setError(message) {
  errorBox.textContent = message || '';
  errorBox.hidden = !message;
}

function setLoading(isLoading) {
  loginButton.disabled = isLoading;
  loginButton.setAttribute('aria-busy', String(isLoading));
  loginButton.innerHTML = isLoading ? '<span aria-hidden="true">⏳</span> Entrando...' : '<span aria-hidden="true">→</span> Entrar';
}

function togglePasswordVisibility() {
  const isPassword = passwordInput.type === 'password';
  passwordInput.type = isPassword ? 'text' : 'password';
  toggleButton.textContent = isPassword ? 'Ocultar' : 'Mostrar';
  toggleButton.setAttribute('aria-label', isPassword ? 'Ocultar senha' : 'Mostrar senha');
  passwordInput.focus();
}

toggleButton.addEventListener('click', togglePasswordVisibility);

function ensureTurnstile() {
  const siteKey = window.TURNSTILE_SITE_KEY || '';

  if (!siteKey) {
    setError('CAPTCHA não configurado. Contate o administrador.');
    return null;
  }

  if (window.turnstile && !turnstileWidgetId) {
    turnstileWidgetId = window.turnstile.render(turnstileContainer, {
      sitekey: siteKey,
      callback: (token) => {
        turnstileToken = token;
      },
      'expired-callback': () => {
        turnstileToken = '';
      },
      'error-callback': () => {
        turnstileToken = '';
      }
    });
  }

  return turnstileWidgetId;
}

async function submitLogin(event) {
  event.preventDefault();
  setError('');

  const identifier = identifierInput.value.trim();
  const password = passwordInput.value;

  if (!identifier || !password) {
    setError('Informe e-mail/usuário e senha para continuar.');
    identifierInput.focus();
    return;
  }

  if (!turnstileToken) {
    setError('Confirme o CAPTCHA antes de continuar.');
    ensureTurnstile();
    return;
  }

  setLoading(true);

  try {
    const response = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier, password, cfTurnstileToken: turnstileToken }),
      credentials: 'same-origin'
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      if (response.status === 429) {
        throw new Error(data.error || 'Muitas tentativas. Tente novamente em alguns minutos.');
      }

      throw new Error(data.error || 'Credenciais inválidas.');
    }

    window.location.href = data.redirect || '/';
  } catch (error) {
    setError(error.message || 'Não foi possível entrar agora.');
    turnstileToken = '';
    if (window.turnstile && turnstileWidgetId !== null) {
      window.turnstile.reset(turnstileWidgetId);
    }
  } finally {
    setLoading(false);
  }
}

form.addEventListener('submit', submitLogin);

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    ensureTurnstile();
  });
} else {
  ensureTurnstile();
}

const script = document.createElement('script');
script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
script.async = true;
script.defer = true;
document.head.appendChild(script);
