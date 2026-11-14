# Como publicar a Ponte (Supabase + Gemini + Vercel)

Tempo estimado: 20 a 30 minutos. Nenhuma senha ou chave deve ser colada em chat, grupo ou no código: as chaves ficam **só nas variáveis de ambiente da Vercel**.

> A Ponte funciona mesmo sem Supabase e sem Gemini (modo demonstração: dados de exemplo em memória e busca por regras). Siga os passos abaixo para a versão completa.

## 1. Supabase (banco de dados)

1. Entre em [supabase.com](https://supabase.com) → **New project**. Anote a senha do banco num lugar seguro (não no código).
2. No menu lateral, abra **SQL Editor** → **New query**.
3. Copie todo o conteúdo de `db/schema.sql`, cole e clique em **Run**. Isso cria as tabelas e liga a segurança (RLS).
4. Abra outra query, cole o conteúdo de `db/seed.sql` e clique em **Run**. Isso carrega as 10 lojas e os produtos fictícios.
5. Vá em **Project Settings → API Keys** e copie a chave **secreta**:
   - aba **API Keys** → **Secret keys** → `sb_secret_...` (ou, na aba **Legacy**, a `service_role`) → será `SUPABASE_SERVICE_ROLE_KEY`
   - **Project URL** (em **Project Settings → Data API**) → será `SUPABASE_URL`

   > Projeto do time já criado (conta indiomau40, região São Paulo): `SUPABASE_URL = https://vfltkwawdicqqeryvyll.supabase.co`. Tabelas e catálogo já carregados — pule os passos 1 a 4.

   A chave service_role só pode ficar no servidor (Vercel). Nunca no front-end, no GitHub ou em mensagens.

## 2. Gemini (inteligência artificial)

1. Entre em [aistudio.google.com](https://aistudio.google.com) com uma conta Google.
2. Clique em **Get API key** → **Create API key**.
3. Copie a chave → será `GEMINI_API_KEY`.
4. (Opcional) `GEMINI_MODEL`: o padrão é `gemini-3.5-flash-lite`. Se a busca por foto der erro de modelo, troque por um modelo Flash listado em [ai.google.dev/gemini-api/docs/models](https://ai.google.dev/gemini-api/docs/models).

## 3. GitHub

1. Crie um repositório (ex.: `ponte`) e envie o código:
   ```bash
   git remote add origin https://github.com/<usuario>/ponte.git
   git push -u origin main
   ```
2. Convide os integrantes em **Settings → Collaborators**.

## 4. Vercel (publicação)

1. Entre em [vercel.com](https://vercel.com) com a conta do GitHub → **Add New → Project** → importe o repositório `ponte`.
2. **Framework Preset:** `Other`. Não precisa de build command nem output directory (deixe em branco).
3. Em **Environment Variables**, adicione:

   | Nome | Valor |
   |---|---|
   | `SUPABASE_URL` | Project URL do passo 1 |
   | `SUPABASE_SERVICE_ROLE_KEY` | service_role key do passo 1 |
   | `GEMINI_API_KEY` | chave do passo 2 |
   | `ADMIN_CODE` | um código só do time para o painel (ex.: `SHOP2026`) |

4. Clique em **Deploy**. Ao terminar, abra `https://<seu-projeto>.vercel.app/api/health`.
   O esperado é: `{"ok":true,"mode":{"data":"supabase","ai":"gemini"}, ...}`.
   - `data: "memory"` → as variáveis do Supabase não foram lidas: confira os nomes e faça **Redeploy**.
   - `ai: "regras"` → a chave do Gemini não foi lida.
5. A cada `git push` na branch `main`, a Vercel publica de novo automaticamente.

## 5. Endereços da demo

| Tela | Endereço | Acesso |
|---|---|---|
| Cliente | `/` | aberto |
| Lojista | `/loja` | código da loja (ver `data/catalog.json`, campo `code`; ex.: `SOM112`) |
| Painel do shopping | `/painel` | `ADMIN_CODE` |

Gere um QR Code para o endereço do cliente e coloque no slide do pitch: a banca escaneia e testa na hora.

## Problemas comuns

| Sintoma | Causa provável | O que fazer |
|---|---|---|
| Busca por foto pede para digitar | `GEMINI_API_KEY` ausente ou inválida | Conferir a variável na Vercel e fazer Redeploy |
| Erro com código de rastreio | Falha no servidor | Painel → aba **Logs** → buscar o código; ou Vercel → **Logs** |
| Reservas somem | Rodando em modo memória | Configurar as variáveis do Supabase |
| `401` no painel | `ADMIN_CODE` diferente | Usar o valor definido na Vercel |
