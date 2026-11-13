import './_helpers.js';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { compare, shippingEstimate, FREE_SHIPPING_FROM, SHIPPING_FEE, TIE_BAND } from '../../lib/compare.js';

describe('compare.js — comparativo online × shopping', () => {
  test('shopping mais barato', () => {
    const c = compare({ onlinePrice: 520, shoppingPrice: 459 });
    assert.equal(c.verdict, 'shopping_mais_barato');
    assert.equal(c.difference, -61);
    assert.equal(c.advantages[0], 'Sai R$ 61,00 mais barato no shopping');
    assert.match(c.summary, /o mesmo produto sai R\$ 61,00 mais barato/);
    assert.equal(c.deliveryDays, 5);
  });

  test('online mais barato: veredito honesto, sem dizer que o shopping é mais barato', () => {
    const c = compare({ onlinePrice: 489.9, shoppingPrice: 499 });
    assert.equal(c.difference, 9.1);
    assert.equal(c.verdict, 'online_mais_barato');
    assert.ok(!c.advantages.some((a) => /mais barato no shopping/.test(a)));
    assert.equal(c.summary, 'Online sai R$ 9,10 mais barato contando o frete, mas chega só em 5 dias.');
    assert.ok(c.advantages.includes('Leva hoje, sem esperar 5 dias'), 'vantagens reais continuam aparecendo');
  });

  test('faixa de empate de ±R$ 5,00 (limites incluídos)', () => {
    assert.equal(TIE_BAND, 5);
    assert.equal(compare({ onlinePrice: 300, shoppingPrice: 305 }).verdict, 'empate');
    assert.equal(compare({ onlinePrice: 300, shoppingPrice: 295 }).verdict, 'empate');
    assert.equal(compare({ onlinePrice: 300, shoppingPrice: 300 }).verdict, 'empate');
    assert.equal(compare({ onlinePrice: 300, shoppingPrice: 305.01 }).verdict, 'online_mais_barato');
    assert.equal(compare({ onlinePrice: 300, shoppingPrice: 294.99 }).verdict, 'shopping_mais_barato');
    assert.match(compare({ onlinePrice: 300, shoppingPrice: 303 }).summary, /praticamente igual.*R\$ 3,00/);
  });

  test('regra de frete: R$ 19,90 abaixo de R$ 199,00; grátis a partir de R$ 199,00', () => {
    assert.equal(FREE_SHIPPING_FROM, 199);
    assert.equal(SHIPPING_FEE, 19.9);
    assert.equal(shippingEstimate(198.99), 19.9);
    assert.equal(shippingEstimate(199), 0);
    assert.equal(shippingEstimate(500), 0);
  });

  test('frete entra na conta: online R$ 179,90 + 19,90 × shopping R$ 189,90 = empate', () => {
    const c = compare({ onlinePrice: 179.9, shoppingPrice: 189.9 });
    assert.equal(c.shippingEstimate, 19.9);
    assert.equal(c.difference, -9.9);
    assert.equal(c.verdict, 'shopping_mais_barato');
    assert.ok(c.advantages.includes('Sem frete (online seria R$ 19,90)'));
    const tie = compare({ onlinePrice: 179.9, shoppingPrice: 199.8 });
    assert.equal(tie.difference, 0);
    assert.equal(tie.verdict, 'empate');
  });

  test('base "parecido" muda a frase', () => {
    const c = compare({ onlinePrice: 520, shoppingPrice: 400, basis: 'parecido' });
    assert.equal(c.basis, 'parecido');
    assert.match(c.summary, /um produto parecido/);
  });

  test('alternativa só aparece se for mais barata que o produto do shopping', () => {
    const alt = { productId: 'tecnoponto-01', name: 'Q45', price: 459, storeName: 'TecnoPonto' };
    const c = compare({ onlinePrice: 489.9, shoppingPrice: 499, alternative: alt });
    assert.deepEqual(c.alternative, alt);
    assert.ok(c.advantages.some((a) => a === 'Opção parecida por R$ 459,00 na TecnoPonto, R$ 30,90 abaixo do online'));
    const none = compare({ onlinePrice: 489.9, shoppingPrice: 499, alternative: { ...alt, price: 600 } });
    assert.equal(none.alternative, null);
  });

  test('preço ausente, zero ou negativo: sem comparativo', () => {
    assert.equal(compare({ onlinePrice: null, shoppingPrice: 100 }), null);
    assert.equal(compare({ onlinePrice: 100, shoppingPrice: 0 }), null);
    assert.equal(compare({ onlinePrice: -5, shoppingPrice: 100 }), null);
  });

  test('arredonda centavos (sem erro de ponto flutuante)', () => {
    const c = compare({ onlinePrice: 0.1 + 0.2, shoppingPrice: 100.3 });
    assert.equal(c.onlinePrice, 0.3);
    assert.equal(c.difference, 80.1);
  });
});
