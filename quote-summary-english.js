(() => {
  'use strict';

  const productNames = {
    paper_bag: 'Paper Bag', mailer_box: 'Mailer Box', magnetic_box: 'Magnetic Gift Box',
    bubble_mailer: 'Bubble Mailer', poly_mailer: 'Poly Mailer', satin_bag: 'Satin Bag',
    plastic_bag: 'Plastic Bag', vest_bag: 'Vest Bag'
  };
  const terms = {
    air: 'Air freight estimate', sea: 'Ocean freight estimate', manual: 'Quoted shipping',
    us_fedex_standard: 'FedEx Standard (US duties included)',
    us_fedex_express: 'FedEx Express (US duties included)',
    us_air_heavy: 'US air freight (duties included)',
    us_sea_clx: 'Ocean freight (CLX)', us_sea_max: 'Ocean freight (MAX)',
    us_sea_exx: 'Ocean freight (EXX)', us_sea_hede: 'Ocean freight (HEDE)',
    us_sea_standard: 'Standard ocean freight'
  };
  const routeNames = {
    'UPS-Expedited': 'UPS Expedited', 'UPS-Saver': 'UPS Saver',
    'FedEx-IP': 'FedEx International Priority', 'FedEx-IE': 'FedEx International Economy',
    ALI_BRAND_OCEAN_US_ECONOMY_DDP: 'Economy ocean freight',
    ALI_BRAND_OCEAN_US_STANDARD_DDP: 'Standard ocean freight',
    ALI_BRAND_OCEAN_US_PREMIUM_DDP: 'Premium ocean freight'
  };
  const sizeTerms = {
    横版: 'Landscape', 竖版: 'Portrait', 冲孔: 'Die-cut handle', 软提手: 'Soft handle',
    厘米: ' cm', 毫米: ' mm', 英寸: ' in'
  };
  const nonEnglishScript = /[^\p{Script=Latin}\p{Script=Common}\p{Script=Inherited}]/u;
  const usd = new Intl.NumberFormat('en-US', {style: 'currency', currency: 'USD'});
  const expiredShipping = 'Previous shipping quote is no longer valid. Please recheck shipping.';

  function plainText(value) {
    const entities = {'&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'"};
    return String(value ?? '').replace(/&(?:amp|lt|gt|quot|#39);/g, match => entities[match])
      .replace(/\s+/g, ' ').trim();
  }

  function productName(item) {
    if (Object.hasOwn(productNames, item.productId)) return productNames[item.productId];
    const name = plainText(item.product);
    return Object.values(productNames).find(english =>
      name.endsWith(english) && (name === english || nonEnglishScript.test(name))) ?? name;
  }

  function shippingLabel(mode, rate) {
    if (!rate) return terms[mode] || 'Shipping';
    const name = plainText(rate.name);
    const route = routeNames[rate.productCode] || (!nonEnglishScript.test(name) && name)
      || (rate.mode === 'air' ? 'Air freight' : rate.mode === 'seaDdp' ? 'Ocean freight' : 'Shipping');
    const incoterm = ['DDP', 'DAP', 'CIF', 'FOB', 'EXW'].includes(rate.term) ? rate.term : '';
    return incoterm && !route.includes(incoterm) ? `${route} (${incoterm})` : route;
  }

  function estimatedTransit(rate) {
    if (!rate || (rate.timeExpiresAt && rate.timeExpiresAt <= Date.now())) return '';
    let min = Number(rate.minDays), max = Number(rate.maxDays);
    let working = rate.timeUnit !== 'calendarDay' && rate.timeUnit !== 'naturalDay';
    if (!(min > 0 && max >= min)) {
      const match = plainText(rate.days).match(/^(\d+)(?:\s*[-–]\s*(\d+))?\s*(工作日|自然日|天|business days?|calendar days?|days?)$/i);
      if (!match) return '';
      min = Number(match[1]);
      max = Number(match[2] ?? match[1]);
      working = /^(工作日|business)/i.test(match[3]);
    }
    if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || min < 1 || max < min) return '';
    const unit = working ? 'business day' : 'calendar day';
    return `${min === max ? min : `${min}–${max}`} ${unit}${max === 1 ? '' : 's'}`;
  }

  function format({items, itemPrice, mode, shipping, rate, markup = 0}) {
    const products = items.reduce((total, item) => total + itemPrice(item), markup);
    const customization = items.reduce((total, item) => total + item.addon, 0);
    const lines = items.map((item, index) => {
      const name = productName(item);
      const size = plainText(item.size).replace(/横版|竖版|冲孔|软提手|厘米|毫米|英寸/g, match => sizeTerms[match]);
      if (nonEnglishScript.test(name + size)) return null;
      const price = itemPrice(item) + (index === 0 ? markup : 0);
      return `${index + 1}. ${[name, size, `${item.qty} pcs`, usd.format(price)].filter(Boolean).join(' | ')}`;
    });
    if (lines.includes(null)) return {error: 'Please use English for product names and specifications before copying.'};

    const transit = estimatedTransit(rate);
    const includesShipping = mode !== 'none';
    return {text: [
      'Quotation (USD)', '',
      ...lines, '',
      `Product subtotal: ${usd.format(products)}`,
      `Customization fees: ${usd.format(customization)}`,
      includesShipping ? `Shipping: ${usd.format(shipping)}` : 'Shipping: Not included',
      ...(includesShipping ? [`Shipping method: ${shippingLabel(mode, rate)}`] : []),
      ...(transit ? [`Estimated transit time: ${transit}`] : []),
      `${includesShipping ? 'Total' : 'Total excluding shipping'}: ${usd.format(products + customization + (includesShipping ? shipping : 0))}`,
      ...(includesShipping ? ['Shipping rates and transit times are subject to confirmation.'] : [])
    ].join('\n')};
  }

  window.EnglishQuoteSummary = {format, expiredShipping};
})();
