# Ponte — Arquitetura e contratos

> Documento de referência para quem desenvolve. Toda parte do sistema segue estes contratos.

## Visão geral

Ponte é um web app (celular primeiro) que leva quem pesquisou um produto na internet até a loja física do shopping.

- **Front-end:** HTML + CSS + JavaScript puro (módulos ES), sem build, em `public/`.
- **API:** funções serverless da Vercel em Node.js 20+ (ESM, sem dependências npm), em `api/`.
- **Regras de negócio:** `lib/` (compartilhado pelas funções).
- **Dados:** Supabase (PostgreSQL via REST) em produção; modo memória (a partir de `data/catalog.json`) para desenvolvimento, testes e plano B da demo.
- **IA:** API Gemini via REST (`generateContent`); sem chave, o sistema usa regras determinísticas (modo "regras").
- **Logs:** logs técnicos em JSON no console (aparecem na Vercel) + eventos de negócio gravados na tabela `events`.

Zero dependências de produção: nada precisa de `npm install` para rodar ou publicar.

## Estrutura de pastas

```
api/                 funções serverless (1 arquivo = 1 rota /api/<nome>)
lib/                 regras de negócio e infraestrutura
  http.js            wrapper de handler: método, JSON, traceId, logs, erros
  logger.js          logs estruturados + registro de eventos
  config.js          leitura de variáveis de ambiente e modos
  db.js              camada de dados (escolhe memória ou Supabase)
  db-memory.js       implementação em memória
  db-supabase.js     implementação via REST do Supabase
  ai.js              Gemini (REST) + fallback por regras
  text.js            normalização de texto, tokens, extração de preço
  search.js          busca e classificação igual/parecido
  compare.js         comparativo online × shopping
  route.js           roteiro de visita por piso
  codes.js           geração de códigos de reserva e traceId
public/              telas (index.html cliente, loja.html lojista, painel.html shopping)
data/catalog.json    catálogo fictício (lojas + produtos)
db/schema.sql        tabelas, índices e RLS do Supabase
db/seed.sql          carga do catálogo (gerado por scripts/gen-seed.js)
scripts/dev.js       servidor local que imita a Vercel (porta 3000)
tests/unit           testes node:test
tests/e2e            testes Playwright
```

## Variáveis de ambiente

| Variável | Uso | Padrão |
|---|---|---|
| `SUPABASE_URL` | URL do projeto Supabase | vazio → modo memória |
| `SUPABASE_SERVICE_ROLE_KEY` | chave service_role (só no servidor) | vazio → modo memória |
| `GEMINI_API_KEY` | chave da API Gemini | vazio → modo regras |
| `GEMINI_MODEL` | modelo Gemini | `gemini-3.5-flash-lite` |
| `ADMIN_CODE` | código de acesso do painel do shopping | `SHOP2026` |
| `DATA_MODE` | força `memory` | automático |
| `PONTE_NO_SEED` | `1` desliga o histórico fictício do modo memória | vazio |

## Modelos de dados

```js
Store       { id, code, name, segment, floor, unit, hours }
            // code = código de acesso do lojista (ex.: "SOM112"); NUNCA devolvido em rotas públicas
Product     { id, store_id, name, category, segment, brand, color, price, stock, tags: string[], description }
Reservation { id, code, product_id, store_id, type: 'separar'|'testar', nickname,
              status: 'aguardando'|'confirmada'|'recusada'|'retirada',
              created_at, updated_at, expires_at }
Event       { id, type, trace_id, data: object, created_at }
```

Tipos de evento (`Event.type`): `busca_realizada`, `busca_sem_resultado`, `reserva_criada`, `reserva_confirmada`, `reserva_recusada`, `retirada_confirmada`, `erro_ia`, `erro_api`.

Preços em reais (number, ex.: `499.9`). Datas em ISO 8601 (UTC).

## Interface da camada de dados (`lib/db.js`)

Todas as funções são `async`. A mesma interface nas duas implementações.

```js
listStores()                         -> Store[]        // sem o campo code
getStoreByCode(code)                 -> Store|null     // com code
listProducts()                       -> Product[]
getProduct(id)                       -> Product|null
createReservation(fields)            -> Reservation
getReservationByCode(code)           -> Reservation|null
listReservationsByStore(storeId)     -> Reservation[]  // mais recentes primeiro
updateReservation(id, patch)         -> Reservation
addEvent({ type, trace_id, data })   -> void
listEvents({ type?, trace_id?, limit? }) -> Event[]    // mais recentes primeiro
mode                                 -> 'memory'|'supabase'
```

## Contrato da API

Todas as rotas respondem JSON e incluem `traceId`. Erro: `{ "error": { "message": "...", "traceId": "A7F3K2" } }` com status 4xx/5xx.
O header `x-trace-id` também volta em toda resposta.

| Rota | Método | Entrada | Saída |
|---|---|---|---|
| `/api/health` | GET | — | `{ ok, mode: { data, ai } }` |
| `/api/stores` | GET | — | `{ stores: Store[] }` (sem `code`) |
| `/api/search` | POST | `{ query?: string, image?: { mimeType, data } }` (data = base64, ≤ 3 MB) | ver abaixo |
| `/api/product` | GET | `?id=` | `{ product: ProductView, similar: ProductView[] }` |
| `/api/reservations` | POST | `{ productId, type, nickname }` | `{ reservation: ReservationView }` |
| `/api/reservations` | GET | `?code=` | `{ reservation: ReservationView }` |
| `/api/route` | POST | `{ productIds: string[] }` | `{ stops: Stop[], summary }` |
| `/api/store-login` | POST | `{ code }` | `{ store }` |
| `/api/store-reservations` | GET | header `x-store-code` | `{ store, reservations: ReservationView[] }` |
| `/api/store-reservations` | POST | header `x-store-code`; `{ id, action: 'confirmar'\|'recusar' }` | `{ reservation }` |
| `/api/store-checkin` | POST | header `x-store-code`; `{ code }` | `{ reservation }` |
| `/api/dashboard` | GET | header `x-admin-code` | ver abaixo |
| `/api/logs` | GET | header `x-admin-code`; `?type=&trace=&limit=` | `{ events: Event[] }` |

`ProductView` = Product + `store: { id, name, segment, floor, unit }`.
`ReservationView` = Reservation + `product: ProductView`.
`Stop` = `{ order, store: {...}, floor, products: ProductView[] }`.

### Resposta de `/api/search`

```js
{
  traceId,
  source: 'ia' | 'regras',          // quem interpretou a busca
  interpreted: { name, category, brand, color, keywords: string[], maxPrice, onlinePrice },
  confidence: 'alta' | 'media' | 'baixa',
  warning: string | null,           // ex.: "Confiança baixa: confira o produto antes de ir."
  results: [ { product: ProductView, match: 'igual' | 'parecido', reason: string, score: number } ],
  comparison: null | {
    onlinePrice, shippingEstimate, deliveryDays,
    shoppingPrice, difference,       // shoppingPrice - (onlinePrice + shippingEstimate)
    verdict: 'shopping_mais_barato' | 'online_mais_barato' | 'empate',
    advantages: string[],            // vantagens de ir à loja, sempre honestas
    basis: 'igual' | 'parecido',     // shoppingPrice é do mesmo produto (menor "igual") ou dos parecidos mais próximos
    summary: string,                 // frase pronta para a tela (ex.: "Online sai R$ 9,10 mais barato contando o frete, ...")
    alternative: null | { productId, name, price, storeName }  // parecido mais barato que o "igual", se houver
  },
  notFound: boolean                  // true quando results está vazio
}
```

Erros de `/api/search`: 400 sem `query` nem `image`, formato de imagem fora de JPG/PNG/WEBP ou base64 inválido
(aceita também data URL); 413 imagem > 3 MB; 400 "Escreva o nome do produto..." quando só há foto e a IA não está
disponível ou falhou (não há como ler a foto por regras).

Frete estimado do online (`lib/compare.js`): R$ 19,90 abaixo de R$ 199,00; grátis a partir de R$ 199,00; entrega em 5 dias.
`verdict` usa faixa de empate de ±R$ 5,00.

### Resposta de `/api/dashboard`

```js
{
  totals: { searches, searchesWithoutResult, reservations, confirmed, refused, pickedUp, aiErrors, apiErrors },
  rates: {                           // números de 0 a 1 (ex.: 0.233)
    searchToReservation,             // reservas criadas / buscas
    reservationToPickup,             // retiradas / reservas criadas
    confirmation,                    // confirmadas / (confirmadas + recusadas)
    searchWithoutResult              // buscas sem resultado / buscas
  },
  unmetDemand: [ { term, category, count } ],   // top 10 de busca_sem_resultado por termo
  topSearches: [ { term, category, count } ],   // top 10 de busca_realizada por termo
  byStore: [ { store: { id, name, segment, floor, unit }, reservations, confirmed, refused, pickedUp } ],
  period: { from, to, events },
  updatedAt
}
```
Tudo é calculado a partir dos eventos (últimos 5000).

### Status e erros das rotas de reserva e loja

- `POST /api/reservations`: 400 dados inválidos (`type` fora de separar/testar, apelido fora de 1–30 caracteres após `trim`);
  404 produto inexistente; 409 produto sem estoque. Código `PT-1234` único.
  Validade (`expires_at`): 22h de hoje no horário de Palmas (UTC−3); se faltarem menos de 2 h para as 22h, vale 4 h a partir de agora.
  O estoque não é baixado na reserva (a loja confirma ou recusa).
- `GET /api/reservations?code=`: 404 se não existir (código sem diferenciar maiúsculas).
- `store-login`, `store-reservations`, `store-checkin`: 401 código de loja ausente/errado. `store`, quando devolvida, nunca traz `code`.
- `POST /api/store-reservations`: 404 se a reserva não for da loja; 409 se não estiver `aguardando`.
- `POST /api/store-checkin`: 404 se a reserva não for da loja; 409 se não estiver `confirmada`.
- `dashboard` e `logs`: 401 sem `x-admin-code` correto. `logs`: 400 para `type` desconhecido; `limit` 1–500 (padrão 100).
- `POST /api/route`: 400 lista vazia/inválida (máx. 20); ids desconhecidos são ignorados; 404 se nenhum existir.
  `summary` ex.: "3 lojas em 2 pisos", "1 loja no piso 1". `Stop.store` inclui `hours`.

### Dados dos eventos (`Event.data`)

| Tipo | data |
|---|---|
| `busca_realizada` | `{ query, term, hasImage, category, results, source }` — `query` = texto normalizado (máx. 80), `term` = nome interpretado normalizado |
| `busca_sem_resultado` | `{ term, category }` |
| `reserva_criada` / `reserva_confirmada` / `reserva_recusada` / `retirada_confirmada` | `{ store_id, product_id, type }` (sem apelido) |
| `erro_ia` | `{ stage: 'interpret' \| 'rank', message }` |
| `erro_api` | `{ route, message }` |

No modo memória, um histórico fictício (~50 eventos e 6 reservas) é criado ao iniciar para o painel não abrir vazio;
esses eventos têm `data.seed = true`. `PONTE_NO_SEED=1` desliga (útil em testes).

### Códigos de demonstração (modo memória e seed)

| Loja | Piso/unidade | Código |
|---|---|---|
| SomMax (Eletrônicos) | 1 / 112 | `SOM112` |
| Vitrine Moda | 1 / 118 | `VIT118` |
| Passo Firme (Calçados) | 1 / 125 | `PAS125` |
| TecnoPonto (Eletrônicos e Informática) | 2 / 204 | `TEC204` |
| Essência Viva (Beleza e Perfumaria) | 2 / 210 | `ESS210` |
| Arena Esportes | 2 / 221 | `ARE221` |
| Nível Games | 2 / 232 | `NIV232` |
| Lar & Cia (Casa) | 3 / 305 | `LAR305` |
| Página Certa (Livraria e Papelaria) | 3 / 312 | `PAG312` |
| Mundo Encantado (Infantil e Brinquedos) | 3 / 318 | `MUN318` |

Painel do shopping: `SHOP2026` (ou `ADMIN_CODE`). Reservas do histórico fictício: `PT-1042` (retirada), `PT-2318` (confirmada,
TecnoPonto), `PT-3675` (retirada), `PT-4821` (recusada), `PT-5190` e `PT-6034` (aguardando).

Regras da IA (uso crítico):
1. A IA nunca inventa produto, estoque ou preço: resultados vêm só do catálogo.
2. Cada resultado tem `reason` (motivo do "igual"/"parecido").
3. Confiança baixa gera `warning`.
4. Comparativo honesto: se o online for mais barato, `verdict = online_mais_barato`.
5. Fotos não são guardadas; logs não guardam imagens nem apelidos.

## Logs (tecnologia sorteada)

- `lib/http.js` gera `traceId` (6 caracteres A–Z/0–9) por requisição e registra uma linha JSON: `{ level, traceId, route, method, status, ms, error? }`.
- Erros não tratados: resposta 500 com `traceId`, evento `erro_api` com `{ route, message }`.
- Falhas da IA: evento `erro_ia` com `{ stage, message }`; a busca continua no modo regras.
- O usuário vê o código de rastreio nas mensagens de erro.
