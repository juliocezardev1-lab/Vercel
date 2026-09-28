# Banco de dados e publicação na Vercel

O projeto continua usando Express e o mesmo frontend. As rotas agora usam
PostgreSQL (Supabase), por meio de `DATABASE_URL`. HTML, CSS e as operações
de cadastrar, listar, apagar um produto e limpar a tabela foram preservados.

## 1. Configurar o Supabase

1. Abra seu projeto no Supabase e clique em **Connect**.
2. Selecione **Transaction pooler** e copie a conexão PostgreSQL completa.
   Use exatamente o host, usuário e porta mostrados pelo painel.
3. Substitua o campo da senha pela senha do banco. Caracteres reservados da
   senha, como `@`, `#`, `/` e `?`, precisam estar codificados para URL.

Exemplo ilustrativo (não é uma conexão pronta):

```dotenv
DATABASE_URL=postgresql://postgres.REFERENCIA:SENHA@HOST_DO_POOLER:6543/postgres
```

A conexão direta presente no `.env` original pode depender de IPv6. Para a
Vercel, use a conexão **Transaction pooler** fornecida pelo Supabase.

A tabela `public.produtos` é criada automaticamente se não existir, sem
apagar uma tabela já existente. São usadas as colunas `id`, `nome`, `preco`
e `quantidade`. O usuário da conexão precisa ter permissão para criar a
tabela e para consultar, inserir e excluir registros.

As conexões remotas usam TLS com validação do certificado. Se aparecer um
erro de certificado, baixe o certificado raiz do seu banco em **Database >
Settings > SSL Configuration** no Supabase e informe seu conteúdo PEM na
variável `DATABASE_SSL_CA`. Ela aceita quebras de linha reais ou `\n`.

## 2. Publicar na Vercel

1. Extraia o ZIP e envie o conteúdo da pasta `CADASTRO_PRODUTOS_V3` ao seu
   repositório. Não envie `node_modules` nem o `.env` com suas credenciais.
2. Importe o repositório na Vercel.
3. Em **Root Directory**, selecione a pasta que contém `vercel.json`,
   `package.json`, `api`, `BACKEND` e `FRONTEND`, e não apenas `BACKEND`.
   Se esses arquivos estiverem na raiz do repositório, mantenha a raiz.
4. Use o preset **Other** e Node.js **24.x**. O `vercel.json` configura
   `npm ci`, dispensa compilação e publica os arquivos de `FRONTEND`.
5. Em **Settings > Environment Variables**, adicione `DATABASE_URL` com a
   conexão do Transaction pooler. Adicione `DATABASE_SSL_CA` se necessário.
   Marque os ambientes em que o aplicativo será usado (Production/Preview).
6. Faça o deploy. Se alterar uma variável depois, faça um novo deploy.

O `.env` local não substitui as variáveis do painel da Vercel. As requisições
do frontend usam `/produtos` no próprio domínio, e o `vercel.json` encaminha
essas rotas para a função `api/index.js`.

## 3. Executar no computador

Requer Node.js 24 e a mesma conexão PostgreSQL.

1. Atualize `BACKEND/.env` com sua conexão. O `.env` original foi preservado
   no ZIP; há também `BACKEND/.env.example` como modelo.
2. No terminal, entre na pasta que contém o `package.json` principal:

```bash
npm ci
npm start
```

3. Acesse `http://localhost:3000`. Abra pelo servidor para que `/produtos`
   alcance a API; abrir o HTML diretamente ou usar outro servidor estático
   não inicia o backend.

Os arquivos SQLite originais foram preservados como estavam. Eles estavam
sem produtos no ZIP recebido e não são usados pela versão PostgreSQL.
`node_modules` não acompanha o ZIP: `npm ci` instala as dependências corretas
para cada sistema, incluindo o Linux usado pela Vercel.

## Alterações realizadas

- Unificação do acesso ao banco em `BACKEND/database.js`, com um pool
  reutilizável, criação da tabela e consultas parametrizadas PostgreSQL.
- Correção da inicialização do servidor e exportação do Express para Vercel.
- Ajuste de uma linha no frontend: a API passou a usar `/produtos`.
- Arquivos de instalação na raiz, configuração Vercel e exclusão de arquivos
  locais/credenciais do envio para publicação.
- Remoção da dependência SQLite, que deixou de ser usada pela aplicação.

## Verificação realizada

A instalação limpa e o empacotamento da função com o builder oficial
`@vercel/node` passaram em Node.js 24. As rotas foram testadas com o driver
`pg` conectado por TCP a um PostgreSQL de teste (PGlite): criação da tabela,
cadastro, consulta, persistência após reconexão, exclusão individual, limpeza
e tratamento de falhas. O HTML e o CSS foram comparados com o ZIP original.

A conexão real com seu Supabase não pôde ser validada neste ambiente, pois
o endereço do banco não foi resolvido (EAI_AGAIN). Não foi feito deploy na
sua conta Vercel. A validação final no seu projeto depende das variáveis de
ambiente e do acesso ao Supabase configurados conforme os passos acima.

## Referências

- [Conexão PostgreSQL no Supabase](https://supabase.com/docs/guides/database/connecting-to-postgres)
- [Funções Node.js na Vercel](https://vercel.com/docs/functions/runtimes/node-js)
- [Configuração da Vercel](https://vercel.com/docs/project-configuration/vercel-json)
- [TLS no node-postgres](https://node-postgres.com/features/ssl)
