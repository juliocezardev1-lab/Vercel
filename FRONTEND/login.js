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
  loginButton.innerHTML = isLoading
    ? '<span aria-hidden="true">⏳</span> Entrando...'
    : '<span aria-hidden="true">→</span> Entrar';
}

function resetTurnstile() {
  turnstileToken = '';
  if (window.turnstile && turnstileWidgetId !== null) {
    window.turnstile.reset(turnstileWidgetId);
  }
}

function togglePasswordVisibility() {
  const isPassword = passwordInput.type === 'password';
  passwordInput.type = isPassword ? 'text' : 'password';
  toggleButton.textContent = isPassword ? 'Ocultar' : 'Mostrar';
  toggleButton.setAttribute('aria-label', isPassword ? 'Ocultar senha' : 'Mostrar senha');
  passwordInput.focus();
}

function renderTurnstile(siteKey) {
  turnstileWidgetId = window.turnstile.render(turnstileContainer, {
    sitekey: siteKey,
    action: 'login',
    callback: (token) => {
      turnstileToken = token;
      setError('');
    },
    'expired-callback': resetTurnstile,
    'timeout-callback': resetTurnstile,
    'error-callback': () => {
      // Avoid calling reset() from an error callback: persistent provider errors
      // can otherwise produce a repeated error/reset cycle.
      turnstileToken = '';
      setError('Não foi possível carregar a verificação. Atualize a página e tente novamente.');
    }
  });
}

async function initializeTurnstile() {
  try {
    const response = await fetch('/api/config', { cache: 'no-store' });
    if (!response.ok) {
      throw new Error('CAPTCHA não configurado. Contate o administrador.');
    }
    const config = await response.json();
    if (!config.turnstileSiteKey) {
      throw new Error('CAPTCHA não configurado. Contate o administrador.');
    }

    const script = document.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.async = true;
    script.defer = true;
    script.onload = () => {
      try {
        renderTurnstile(config.turnstileSiteKey);
      } catch {
        setError('Não foi possível carregar a verificação. Atualize a página e tente novamente.');
      }
    };
    script.onerror = () => {
      setError('Não foi possível carregar a verificação. Atualize a página e tente novamente.');
    };
    document.head.appendChild(script);
  } catch (error) {
    setError(error.message || 'Login temporariamente indisponível.');
  }
}

async function submitLogin(event) {
  event.preventDefault();
  if (loginButton.disabled) return;
  setError('');

  const identifier = identifierInput.value.trim();
  const password = passwordInput.value;

  if (!identifier || !password) {
    setError('Informe e-mail/usuário e senha para continuar.');
    identifierInput.focus();
    return;
  }

  if (!turnstileToken) {
    setError('Conclua a verificação antes de continuar.');
    return;
  }

  setLoading(true);
  try {
    const response = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier, password, cfTurnstileToken: turnstileToken }),
      credentials: 'same-origin',
      cache: 'no-store'
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data.error || 'Não foi possível entrar agora.');
    }

    window.location.assign('/');
  } catch (error) {
    setError(error.message || 'Não foi possível entrar agora.');
    resetTurnstile();
  } finally {
    setLoading(false);
  }
}

toggleButton.addEventListener('click', togglePasswordVisibility);
form.addEventListener('submit', submitLogin);
initializeTurnstile();
