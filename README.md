
# Ponte — viu online, resolve hoje no shopping

**HackaRun 2026 · Edição Capim Dourado Shopping · Desafio 04: Integração da jornada de compra digital e física**
**Time Rackron:** Pedro Henrique Carvalho Turibio · Carlos Daniel Pereira Queiroz · Artur Braga Sousa · Pedro Henrique Braga Oliveira

A pessoa pesquisa um produto na internet, manda o **print, a foto ou o nome**, e a Ponte mostra **em qual loja do shopping tem**, compara com o preço online de forma honesta, **separa o produto** para retirar hoje e monta o **roteiro por piso**. O lojista confirma a reserva e faz o check-in pelo QR. O shopping enxerga a **demanda não atendida**, ou seja, o que as pessoas procuram e nenhuma loja tem.

## O problema

O consumidor decide na internet, mas não sabe se o produto existe no shopping, onde está e se vale a ida. Então compra online ou vai às cegas. O shopping perde a venda sem saber que ela existiu, e o lojista não sabe o que o cliente pesquisou antes de chegar.

## O que a Ponte faz

| Para quem | Funcionalidade |
|---|---|
| Cliente | Busca por texto ou por **foto/print** (IA) · resultados "Igual" ou "Parecido" com o motivo · **comparativo online × shopping** (frete, prazo, preço) · "Separa pra mim" ou "Quero testar na loja" · reserva com **QR Code** e status ao vivo · **roteiro** por piso |
| Lojista (`/loja`) | Login com o código da loja · reservas pendentes, confirmadas e histórico · confirmar/recusar · **check-in** por QR (câmera) ou código |
| Shopping (`/painel`) | Buscas, reservas, retiradas e conversão · **demanda não atendida** · mais buscados · reservas por loja · **logs** com busca por código de rastreio · **modo telão** para o painel de LED |

Telas: [`docs/screens/`](docs/screens/).

## Como rodar

Não há dependências npm: basta o Node 20+ **ou** o Docker. Sem chaves configuradas, a Ponte roda em **modo demonstração** (catálogo fictício em memória + busca por regras).

### Com Docker (recomendado)

```bash
cp .env.example .env          # opcional: preencha as chaves para o modo completo
docker compose up --build
```

Abra http://localhost:3000.

### Com Node

```bash
node scripts/dev.js           # ou: npm run dev
```

Abra http://localhost:3000. Para usar Supabase e Gemini localmente, defina as variáveis de `.env.example` no terminal antes de rodar.

### Endereços e códigos da demo

| Tela | Endereço | Acesso |
|---|---|---|
| Cliente | `/` | aberto |
| Lojista | `/loja` | código da loja, ex.: `SOM112` (SomMax), `TEC204` (TecnoPonto); todos em `data/catalog.json` |
| Painel do shopping | `/painel` | `ADMIN_CODE` (padrão `SHOP2026`) |

Roteiro da demo: buscar "fone com cancelamento de ruído por R$ 599" → abrir o resultado → "Separa pra mim" → entrar como lojista `TEC204` e confirmar → ver a tela do cliente mudar sozinha → fazer o check-in com o código → abrir o painel.

### Publicar (Vercel + Supabase + Gemini)

Passo a passo em [`docs/DEPLOY.md`](docs/DEPLOY.md). As chaves ficam só nas variáveis de ambiente da Vercel (ou no `.env` local), nunca no código.

## Testes

```bash
npm test          # 123 testes unitários e de API (node:test), sem rede
npm run test:e2e  # teste ponta a ponta no navegador (Playwright + Chromium)
```

Resultados, cobertura e **bugs encontrados e corrigidos** (com os commits): [`docs/TESTES.md`](docs/TESTES.md).

## Arquitetura

```
Celular (cliente) / lojista / painel
        │  HTTPS + JSON
        ▼
public/  ── telas em HTML, CSS e JavaScript puro
api/     ── funções serverless (Node.js), uma por rota
lib/     ── regras: busca, IA, comparativo, roteiro, reservas, logs
        │                       │
        ▼                       ▼
Supabase (PostgreSQL)      API Gemini
lojas, produtos,           lê foto/print, interpreta o pedido
reservas, eventos          e explica cada resultado
```

- **Linguagem:** JavaScript (ES Modules), no front-end e no back-end.
- **Plataforma:** web app pensado para celular, sem instalar nada.
- **Execução:** Vercel (funções serverless) ou Docker (`node:22-alpine`).
- **Dados:** Supabase/PostgreSQL com RLS ligado e acesso só pelo servidor; modo memória para desenvolvimento, testes e plano B.
- **Zero dependências de produção:** nada de `npm install`, menos pontos de falha.

Contratos de cada rota, modelos de dados e eventos: [`ARCHITECTURE.md`](ARCHITECTURE.md). Banco: [`db/schema.sql`](db/schema.sql) e [`db/seed.sql`](db/seed.sql).

## Tecnologia sorteada: Logs

- Toda chamada da API gera um **código de rastreio** (ex.: `A7F3K2`), que volta no header `x-trace-id` e aparece para o usuário em caso de erro.
- **Logs técnicos** em JSON (rota, método, status, duração, erro) no console, visíveis no painel de logs da Vercel ou em `docker compose logs`.
- **Eventos de negócio** gravados no banco: `busca_realizada`, `busca_sem_resultado`, `reserva_criada`, `reserva_confirmada`, `reserva_recusada`, `retirada_confirmada`, `erro_ia`, `erro_api`. Eles alimentam o painel (conversão e demanda não atendida).
- Aba **Logs** no painel do shopping, com filtro por tipo e busca pelo código de rastreio.
- **Privacidade:** logs e eventos nunca guardam fotos, prints nem apelidos.

## Uso de inteligência artificial (declaração, item 6.3 do regulamento)

**IA dentro do produto:**

| Ferramenta | Finalidade |
|---|---|
| API Gemini (Google), modelo Flash | Interpretar texto e foto/print (o que é o produto, marca, cor, preço visto online) e classificar candidatos do catálogo em "igual"/"parecido" com um motivo curto |

Regras de uso crítico, garantidas no código e cobertas por testes:
1. A IA **nunca inventa** produto, estoque ou preço: só escolhe entre itens do catálogo; ids inventados são descartados.
2. Todo resultado traz o **motivo** e a busca traz o **grau de confiança**; confiança baixa gera aviso na tela.
3. O comparativo é **honesto**: quando o online é mais barato, a Ponte diz.
4. **Humano decide:** a reserva só vale depois que o lojista confirma.
5. Se a IA falhar ou estiver indisponível, a busca continua funcionando por **regras**, e a falha vira um evento `erro_ia` nos logs.
6. Fotos não são armazenadas.

**IA no desenvolvimento:**

| Ferramenta | Finalidade |
|---|---|
| Claude (Anthropic) | Apoio na ideação e no planejamento (Missão 1), geração e revisão de código, escrita de testes automatizados, documentação e revisão das telas. Todo o código foi executado e testado (ver `docs/TESTES.md`) e revisado pelo time. |

## Recursos externos (item 11.1)

- **Nenhuma biblioteca de terceiros** em produção. O gerador de QR Code (`public/js/qr.js`) e os ícones SVG foram escritos para o projeto.
- **Serviços:** Supabase (banco), API Gemini (IA), Vercel (hospedagem), GitHub (código).
- **Ferramentas de desenvolvimento:** Node.js, Docker (imagem oficial `node:22-alpine`), Playwright (teste ponta a ponta).
- **Dados:** lojas, marcas, produtos e preços são **fictícios**. Não usamos marcas, logos ou dados reais do shopping ou de lojistas.

## Limitações conhecidas

- No modo memória, cada instância guarda os próprios dados: na Vercel, use o Supabase para reservas persistentes.
- A reserva não baixa o estoque, e o check-in ainda aceita reservas fora do horário de validade.
- **Estoque em tempo real:** no protótipo, o estoque vem de um catálogo cadastrado. Em produção, a Ponte precisaria se integrar ao sistema de estoque/PDV de cada loja (por API ou por atualização periódica). Até lá, a confirmação do lojista em cada reserva garante que o produto existe de fato antes de o cliente ir à loja.
- O leitor de QR por câmera depende do navegador (Chrome no Android); nos outros, o lojista digita o código.
- O pagamento não faz parte do MVP: o foco é levar o cliente até a loja física.
