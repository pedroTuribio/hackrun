# Testes da Ponte

Testes automatizados com o executor nativo do Node (`node:test` + `node:assert/strict`). Nenhuma dependência,
nenhum `npm install`, nenhuma rede: a IA (Gemini) e o Supabase são simulados trocando o `fetch` global.

## Como rodar

```bash
npm test                                   # todos os testes (Node 20+)
node --test tests/unit/search.test.js      # um arquivo só
```

Os testes já ligam sozinhos (em `tests/unit/_helpers.js`) o modo de teste:
`PONTE_QUIET=1`, `DATA_MODE=memory`, `PONTE_NO_SEED=1` e **sem** `GEMINI_API_KEY` (modo regras).
Os testes de IA definem uma chave falsa e respondem no lugar do Gemini.
Os testes de API sobem o servidor local de verdade (`scripts/dev.js`) numa porta livre e fazem chamadas HTTP reais.

## Arquivos de teste

| Arquivo | O que cobre |
|---|---|
| `tests/unit/text.test.js` | Normalização (acentos, maiúsculas, espaços), tokens e stopwords, "sem fio"/"com fio", plural simples, sinônimos, `parseNumber` e extração de preço: "até 500", "até R$ 500,00", "abaixo de 300", "até 4 mil", "R$ 489,90", "1.299,00", máximo + preço online na mesma frase, número de modelo que não é preço. |
| `tests/unit/search.test.js` | Consultas da demo: "fone com cancelamento de ruído" → SomMax e TecnoPonto; "tênis de corrida até 400" respeita o máximo e exclui estoque 0; "patinete elétrico" → `notFound` + evento `busca_sem_resultado`. "Igual" por marca + modelo, comparativo honesto, "sem fio" não traz fone com fio. Invariantes em 15+ consultas: produto, preço e estoque sempre do catálogo, `match` ∈ {igual, parecido}, `reason` não vazio (≤ 80), no máximo 6 resultados, sem código de loja. Só foto sem IA → 400; imagem fora dos eventos. Nome interpretado sem trechos de preço. |
| `tests/unit/ai.test.js` | Gemini simulado: JSON válido → `source: 'ia'`; chave no header (nunca na URL); id inventado e duplicado descartados; JSON malformado na interpretação → regras + `erro_ia` (stage `interpret`); malformado na classificação → regras + `erro_ia` (stage `rank`); HTTP 500 e falha de rede → regras; bloco ```` ```json ````; "null"/confiança inválida; preço em texto brasileiro; confiança baixa → `warning`; foto vai ao Gemini mas não aos eventos. |
| `tests/unit/ai-modelo.test.js` | 404 do modelo configurado → nova tentativa com `gemini-2.5-flash`, que passa a ser usado direto; sem chave a IA nem é chamada. (Arquivo separado porque o modelo reserva é estado do módulo.) |
| `tests/unit/compare.test.js` | Shopping mais barato; online mais barato (veredito honesto, sem "mais barato no shopping"); faixa de empate ±R$ 5,00 com limites; frete R$ 19,90 abaixo de R$ 199,00 e grátis a partir de R$ 199,00; frete entrando na conta; base "parecido"; alternativa mais barata; preços inválidos; arredondamento. |
| `tests/unit/route.test.js` | Ordem por piso e número da loja; agrupamento por loja sem repetir produto; `summary` ("4 lojas em 3 pisos", "3 lojas no piso 1", "1 loja no piso 2"); horário presente e código da loja ausente; ids desconhecidos ignorados. |
| `tests/unit/reservas.test.js` | Validade da reserva no horário de Palmas (manhã, limite de 2 h, depois das 22h, após meia-noite); formato de códigos `PT-1234` e traceId; banco em memória (histórico da demo PT-1042…PT-6034, `seed: true`, ordenação, `code` nunca em `listStores`, código duplicado, cópias defensivas); indicadores do painel (totais, taxas, demanda não atendida, sem divisão por zero); `lib/http.js` no formato da Vercel (`req.body` já lido, `req.query`). |
| `tests/unit/api.test.js` | **Fluxo completo via HTTP:** health → stores → busca → produto → reserva (POST) → consulta por código → login da loja → lista da loja → check-in antes da confirmação (409) → outra loja (404) → confirmar (e 409 ao repetir) → check-in (e 409 ao repetir) → painel conta busca/reserva/confirmação/retirada → logs filtrados por traceId e por tipo → roteiro. **Erros:** 405, 400 JSON inválido (4 rotas), 400 busca vazia/não-texto/imagem GIF/base64 inválido, 400 só foto sem IA (data URL), 413 imagem > 3 MB, 400/404/409 na reserva (tipo, apelido 0 e 31 caracteres, produto inexistente, sem estoque), 401 loja e admin errados, recusa + check-in de recusada (409), logs com tipo/rastreio inválidos e limite, roteiro inválido, produto 400/404, URL malformada no servidor local. **Em toda resposta:** `traceId` no corpo = header `x-trace-id`; erros só com `{ error: { message, traceId } }`. |
| `tests/unit/privacidade.test.js` | Apelido nunca aparece nos eventos nem nos logs técnicos (reserva → confirmação → retirada, e no erro de validação); imagem nunca aparece nos eventos/logs; logs técnicos são JSON com traceId, rota, método, status e ms; falha no banco → 500 com mensagem genérica, `traceId` e evento `erro_api` `{ route, message }` (visível em `/api/logs` e no painel); falha ao gravar evento não derruba a requisição. |
| `tests/unit/db-supabase.test.js` | Camada Supabase com fetch simulado: headers `apikey`/`Authorization`, `listStores` sem `code`, preço/estoque em texto → número, cache do catálogo, maiúsculas e escape na URL, 409 → `duplicate`, erro sem vazar a chave, `return=minimal`, limite 5000, PATCH sem linha. Modos em `config.js`. |

## Resultado final

114 testes, 114 passando, 0 falhas (rodado 3 vezes seguidas, sem instabilidade). Saída de `npm test`:

```
> ponte@1.0.0 test
> node --test tests/unit/*.test.js

# tests 114
# suites 20
# pass 114
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 1245.437214
```

Por arquivo: text 15 · search 13 · ai 12 · ai-modelo 2 · compare 9 · route 5 · reservas 14 · api 32 · privacidade 4 · db-supabase 8.

## Bugs encontrados e corrigidos

| # | Descrição | Como foi encontrado (teste) | Correção | Commit |
|---|---|---|---|---|
| 1 | `npm test` não rodava nada: `node --test tests/unit/` falhava com `MODULE_NOT_FOUND` no Node 22 (pasta não é aceita como argumento). | Primeira execução de `npm test` com a suíte pronta. | Script passou a ser `node --test tests/unit/*.test.js` (`package.json`). | `a63147f` |
| 2 | O nome interpretado da busca mantinha trechos de preço: "tênis abaixo de 300" → "tênis abaixo de 300", "notebook até 4 mil" → "notebook mil", "headphone Q45 por 520 reais" → "headphone Q45 por 520". Aparecia na tela ("Você procurou…") e virava termo no painel (mais buscados / demanda não atendida), dividindo a mesma busca em vários termos. | `search.test.js` → "nome interpretado não carrega expressões de preço" e "termo do evento não carrega o preço". | `cleanName` (`lib/search.js`) passou a usar as mesmas expressões de `parsePrices`, por meio de `priceRanges` (nova, em `lib/text.js`), preservando acentos e maiúsculas. | `297ed86` |
| 3 | Preço em texto vindo do Gemini era lido errado: "1.299,00" → `null` e "1.299" → R$ 1,30 (comparativo e filtro de preço errados ou ausentes no modo IA). | `ai.test.js` → "preço em texto no formato brasileiro". | `price()` em `lib/ai.js` usa `parseNumber` de `lib/text.js` (mesma regra da busca por texto). | `6f4bce2` |
| 4 | Uma URL malformada (ex.: `GET /%E0%A4%A`) derrubava o servidor local `scripts/dev.js` (`URIError` sem tratamento) — é o plano B da demonstração. | `api.test.js` → "servidor local: URL malformada responde 400 e o servidor continua de pé" (o teste travava). | `decodeURIComponent` dentro de `try`, respondendo 400. Os testes HTTP ganharam tempo limite de 10 s para travas virarem falha. | `426dd34` |

### Observações (não são bugs; ficam registradas)

- **Fora da categoria:** "notebook até 1.299,00" traz só a "Mochila para Notebook" como *parecido* ("Outra categoria"), e não registra demanda não atendida. Testamos esconder resultados de outra categoria, mas isso quebraria buscas pelo nome exato (ex.: "Jogo de Cama Casal 4 Peças", que as regras classificam como "Jogos"). Mantido: o motivo deixa claro que é outra categoria.
- **Supabase:** o painel pede os últimos 5000 eventos, mas o PostgREST do Supabase limita por padrão a 1000 linhas por consulta (`Max rows`). Para a demo é suficiente; para mais volume, aumentar o limite no projeto ou paginar.
- **Validade:** o check-in não bloqueia reservas vencidas (`expires_at` é informativo; o contrato não exige bloqueio).

## Testes manuais (checklist da demo)

Rodar `npm run dev` (sem chaves = memória + regras) ou abrir a URL publicada.

- [ ] `/api/health` responde `ok: true` e mostra os modos (`memory`/`supabase`, `regras`/`gemini`).
- [ ] Cliente: buscar **"fone com cancelamento de ruído"** → aparecem SomMax e TecnoPonto, cada um com "igual"/"parecido" e motivo.
- [ ] Buscar **"fone Sonora Pulse 700 R$ 489,90"** → comparativo honesto: "Online sai R$ 9,10 mais barato…" e opção parecida na TecnoPonto.
- [ ] Buscar **"tênis de corrida até 400"** → nenhum preço acima de R$ 400 e nenhum produto sem estoque.
- [ ] Buscar **"patinete elétrico"** → tela de "não encontrado"; depois conferir no painel em *Demanda não atendida*.
- [ ] Com Gemini ligado: enviar foto/print de um fone → resultados com `source: ia`. Sem Gemini: só foto pede para escrever o nome.
- [ ] Reservar um produto com apelido → código `PT-xxxx` e QR Code aparecem; consultar a reserva pelo código.
- [ ] Lojista (`/loja`): entrar com **TEC204** (ou a loja do produto reservado) → reserva aparece "aguardando"; tentar retirar antes de confirmar mostra aviso; **Confirmar**; fazer check-in pelo código/QR → "retirada".
- [ ] Código de loja errado → mensagem de erro com código de rastreio.
- [ ] Painel (`/painel`, código **SHOP2026**): contadores de buscas, reservas, confirmadas e retiradas aumentaram; *Logs* filtrando pelo código de rastreio de uma mensagem de erro mostra o evento.
- [ ] Roteiro com 2+ produtos de pisos diferentes → ordem por piso e resumo ("2 lojas em 2 pisos").
- [ ] Celular (390 px): telas sem rolagem lateral; mensagens de erro mostram o código de rastreio.
