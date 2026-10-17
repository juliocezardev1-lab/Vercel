# Cadastro de Produtos V4 — pacote corrigido

Origem: ZIP fornecido pelo usuário. Nenhuma alteração foi enviada à Vercel, GitHub ou PostgreSQL.

## Arquivos modificados

- `vercel.json`: regras de rewrite para `/login` e `/login/`.
- `BACKEND/server.js`: rotas de login em Express e redirecionamento para `/login`.
- `FRONTEND/login.html`: título correto e caminhos absolutos para recursos.
- `FRONTEND/index.html`: caminhos absolutos para recursos.
- `FRONTEND/style.css`: fontes de sistema como fallback, sem incorporar arquivos de fonte ao ZIP.
- `FRONTEND/login.js`: impede ciclo de reset ao falhar o Turnstile.
- `FRONTEND/script.js`: redireciona para `/login`.
- `BACKEND/test/auth.test.js`: testa rotas locais de login.
- `BACKEND/test/deployment.test.js`: testes adicionais de configuração e de segurança (novo).
- `BACKEND/README.md`: documentação da correção.

## Executar no seu PC (PowerShell)

1. Extraia o ZIP, entre na pasta `CADASTRO_PRODUTOS_V4`.
2. Execute `npm ci`, depois `npm test`.
3. Configure as variáveis conforme `BACKEND/.env.example` — sem publicar segredos no GitHub.
4. Configure um banco PostgreSQL **de testes**, aplique `BACKEND/migrations/001-authentication.sql` com backup.
5. Crie o administrador no banco de testes com `npm run create-admin`.
6. Teste a aplicação local com `npm run dev`, acessando `http://localhost:3000/login`.
7. Faça um deploy de **Preview** na Vercel; valide `/login`, `/login/`, `/api/config`, o CAPTCHA e o login.
8. Só depois considere produção. **Não execute a migração diretamente no banco de produção sem backup.**

Variáveis essenciais: `DATABASE_URL`, `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`, `TURNSTILE_EXPECTED_HOSTNAME` e `RATE_LIMIT_SECRET`. A `TURNSTILE_SECRET_KEY` deve existir somente no backend.

## Segurança do ZIP

Arquivos `.env`/`.env.local`, diretórios `.git`/`node_modules` e arquivos `.db` e arquivos de fonte foram intencionalmente **excluídos**, para não compartilhar credenciais, histórico de Git ou bancos de dados locais. `BACKEND/.env.example` permanece como referência.

## Limite de validação

Testes que requerem PostgreSQL real ou chaves reais da Cloudflare devem ser executados no seu ambiente de Preview. Os testes de integração existentes usam simulações e não comprovam funcionamento com o banco em produção.
