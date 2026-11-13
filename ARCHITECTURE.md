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
| `GEMINI_MODEL` | modelo Gemini | `gemini-flash-latest` |
| `ADMIN_CODE` | código de acesso do painel do shopping | `SHOP2026` |
| `DATA_MODE` | força `memory` | automático |

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
    advantages: string[]             // vantagens de ir à loja, sempre honestas
  },
  notFound: boolean                  // true quando results está vazio
}
```

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
