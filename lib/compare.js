// Comparativo honesto: preço visto online (+ frete estimado) × preço no shopping.
import { brl } from './text.js';

// Regra simples e documentada de frete estimado do e-commerce:
// abaixo de R$ 199,00 -> R$ 19,90; a partir de R$ 199,00 -> grátis. Entrega estimada: 5 dias.
export const FREE_SHIPPING_FROM = 199;
export const SHIPPING_FEE = 19.9;
export const DELIVERY_DAYS = 5;
export const TIE_BAND = 5; // diferença de até R$ 5 = empate

const round2 = (n) => Math.round(n * 100) / 100;

export function shippingEstimate(onlinePrice) {
  return onlinePrice >= FREE_SHIPPING_FROM ? 0 : SHIPPING_FEE;
}

/**
 * compare({ onlinePrice, shoppingPrice, basis? })
 * basis = 'igual' quando o preço do shopping é do mesmo produto; 'parecido' quando é de um similar.
 * alternative = { productId, name, price, storeName } de um parecido mais barato que o "igual" (opcional).
 */
export function compare({ onlinePrice, shoppingPrice, basis = 'igual', alternative = null }) {
  if (!(onlinePrice > 0) || !(shoppingPrice > 0)) return null;
  const shipping = shippingEstimate(onlinePrice);
  const onlineTotal = round2(onlinePrice + shipping);
  const difference = round2(shoppingPrice - onlineTotal);
  const verdict = difference < -TIE_BAND ? 'shopping_mais_barato'
    : difference > TIE_BAND ? 'online_mais_barato' : 'empate';
  const gap = brl(Math.abs(difference));
  const what = basis === 'igual' ? 'o mesmo produto' : 'um produto parecido';

  const advantages = [];
  if (verdict === 'shopping_mais_barato') advantages.push(`Sai ${gap} mais barato no shopping`);
  advantages.push(`Leva hoje, sem esperar ${DELIVERY_DAYS} dias`);
  if (shipping > 0) advantages.push(`Sem frete (online seria ${brl(shipping)})`);
  advantages.push('Teste antes de pagar');
  advantages.push('Troca direto no balcão');
  if (alternative && alternative.price < shoppingPrice) {
    const alt = round2(alternative.price);
    const vsOnline = alt < onlineTotal - TIE_BAND ? `, ${brl(round2(onlineTotal - alt))} abaixo do online` : '';
    advantages.push(`Opção parecida por ${brl(alt)} na ${alternative.storeName}${vsOnline}`);
  }

  const summary = verdict === 'shopping_mais_barato'
    ? `No shopping, ${what} sai ${gap} mais barato que online com frete.`
    : verdict === 'online_mais_barato'
      ? `Online sai ${gap} mais barato contando o frete, mas chega só em ${DELIVERY_DAYS} dias.`
      : `Preço praticamente igual ao online com frete (diferença de ${gap}).`;

  return {
    onlinePrice: round2(onlinePrice),
    shippingEstimate: shipping,
    deliveryDays: DELIVERY_DAYS,
    shoppingPrice: round2(shoppingPrice),
    difference,
    verdict,
    advantages,
    basis,
    summary,
    alternative: alternative && alternative.price < shoppingPrice ? { ...alternative, price: round2(alternative.price) } : null,
  };
}
