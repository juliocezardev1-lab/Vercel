# Authentication and deployment

## Architecture

The existing application is a static HTML/CSS/JavaScript product dashboard with an Express 5 API. Locally, Express serves the frontend; on Vercel, `api/index.js` and the authentication entry points export the same Express application. PostgreSQL (configured with `DATABASE_URL`, currently intended for Supabase) remains the only application database.

There was no existing users table, login handler, or server-side session implementation in the repository. The current product-management interface is now restricted to active administrator accounts. There is no public registration endpoint.

## Database setup

Authentication uses three additive PostgreSQL tables:

- `auth_users` stores a normalized account identifier, bcrypt password hash, role, and active flag.
- `auth_sessions` stores only a SHA-256 hash of each random session token and its expiration.
- `login_attempts` stores hashed identifier/IP rate-limit buckets, not the identifier or IP address.

Before enabling login, review and apply [`migrations/001-authentication.sql`](./migrations/001-authentication.sql) through the approved database-change process. The migration only creates these tables and indexes; it does not modify or delete product records. It is deliberately not run automatically by the application. Confirm that the runtime database role has only the required access to the new tables; run administrator provisioning with a role authorized to insert into `auth_users`.

The repository does not contain a pre-existing administrator account or password database to migrate. Create the initial administrator after applying the schema:

1. Set `ADMIN_IDENTIFIER` and a unique `ADMIN_PASSWORD` of at least 12 and at most 72 UTF-8 bytes in a temporary, protected environment.
2. Run `npm run create-admin` from the repository root.
3. Clear the temporary variables and verify that the administrator can log in.

The command never prints the password, does not overwrite an existing account, and creates only an administrator. Do not put real values in a committed file or shell history.

## Environment configuration

Copy [`BACKEND/.env.example`](./.env.example) to `BACKEND/.env` for local development and replace every placeholder. For Vercel, configure variables separately for Development, Preview, and Production:

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Existing PostgreSQL/Supabase connection URI |
| `TURNSTILE_SITE_KEY` | Public Cloudflare Turnstile site key |
| `TURNSTILE_SECRET_KEY` | Private Turnstile Siteverify secret; server-side only |
| `TURNSTILE_EXPECTED_HOSTNAME` | Exact hostname configured for the Turnstile site |
| `RATE_LIMIT_SECRET` | Random private key used to HMAC rate-limit identifiers and IP addresses |
| `DATABASE_SSL_CA` | Optional CA when the database provider requires a private certificate |

Login fails closed when the Turnstile secret, expected hostname, or rate-limit secret is missing. Generate a high-entropy `RATE_LIMIT_SECRET` with a password manager or cryptographic random generator; rotating it resets the rate-limit buckets. The public configuration endpoint returns only the site key, and only when all required settings are present. Use Cloudflare's testing keys only in an isolated non-production environment.

No Vercel deployment or database migration was performed as part of this change.

## Login and session behavior

- Login accepts an email or username stored in `auth_users.identifier`; it checks a bcrypt hash and returns generic errors for nonexistent users and incorrect passwords.
- Cloudflare Turnstile is verified by the server using Siteverify. Successful responses must match both `TURNSTILE_EXPECTED_HOSTNAME` and the `login` action. Network failures, missing configuration, invalid, expired, or replayed tokens do not authenticate.
- Sessions use random 256-bit tokens in HTTP-only, `SameSite=Strict` cookies. Production uses the `__Host-` cookie prefix and `Secure`; the database stores only the token hash. Sessions expire after eight hours and are revoked on logout.
- Product APIs and the dashboard entry point require a valid active administrator session. Unsafe requests also require a same-origin `Origin` header.
- Login attempts are limited in PostgreSQL to eight per 15-minute window for both the normalized account identifier and client IP. This works across Vercel function instances; old buckets and expired sessions are cleaned during authentication traffic.
- No session state is held only in process memory. Authentication responses and APIs are marked `Cache-Control: no-store`.

## Local checks

Run `npm ci`, configure `BACKEND/.env`, and apply the database migration before starting the app with `npm run dev`. Run `npm test` for the automated auth/API tests. These tests use an in-process HTTP server, a fake database adapter, and mocked Siteverify responses; they do not access production data or prove connectivity to the configured Supabase or Cloudflare accounts.

The Vercel configuration rewrites both `/login` and `/login/` to the public `FRONTEND/login.html`, routes `/` and `/index.html` through the authenticated dashboard handler, maps login/session/config endpoints to serverless handlers, and adds a restrictive Content Security Policy that allows the Turnstile origin. Configure all listed environment variables and apply the migration before deployment. Deploy manually through the normal release process after validating the Preview environment.

## Troubleshooting

- **Login temporarily unavailable:** check the database migration, database permissions, and required Turnstile environment variables.
- **CAPTCHA does not render:** verify that the site key and expected hostname belong to the same Cloudflare Turnstile site, then inspect browser network/CSP errors.
- **CAPTCHA is rejected:** confirm the exact hostname and `login` action; use a fresh token for every attempt.
- **Database errors:** server responses remain generic; use the server-side error code in trusted deployment logs and check PostgreSQL connectivity without logging connection strings.
- **Administrator already exists:** the provisioning command intentionally refuses to overwrite accounts. Use the approved database account-management procedure to reset or deactivate one.

## Correções de roteamento (pacote revisado)

- `GET /login` e `GET /login/` agora entregam `FRONTEND/login.html` tanto localmente (Express) quanto no deployment Vercel (rewrites).
- Acesso não autenticado ao painel redireciona para `/login`.
- Assets de login/painel usam caminhos absolutos (`/style.css`, `/login.js`, `/script.js`) para funcionar com e sem barra final.
- O título do login corresponde ao projeto Cadastro de Produtos, sem referência a outros sites.
- No Turnstile, o callback de erro não chama `reset()` repetidamente.
- Verificações automatizadas de rotas e configurações estão em `test/deployment.test.js`.

**Antes de publicar:** execute `npm ci`, `npm test` e valide a página `/login` e o fluxo de login em Preview com as variáveis e o PostgreSQL de testes. A migração `001-authentication.sql` e `npm run create-admin` exigem execução deliberada no banco correto; este pacote não altera bancos nem projetos remotos.
