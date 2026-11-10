(() => {
  'use strict';

  const byId = id => document.getElementById(id);
  const panel = byId('factoryCostPanel');
  const catalogFile = byId('factoryCostImportFile');
  if (!panel || (!catalogFile && !['127.0.0.1', 'localhost', '[::1]'].includes(location.hostname))) return;

  const salesView = byId('salesQuoteView');
  const salesButton = byId('salesQuoteButton');
  const costButton = byId('factoryCostButton');
  const reference = byId('factoryCostReference');
  const importQuote = byId('factoryCostImport');
  const item = byId('factoryCostItem');
  const supplier = byId('factoryCostSupplier');
  const supplierDefaults = [...supplier.options].map(option => [option.value, option.textContent]);
  const size = byId('factoryCostSize');
  const quantity = byId('factoryCostQty');
  const amount = byId('factoryCostAmount');
  const basis = byId('factoryCostBasis');
  const exchange = byId('exchangeRate');
  const status = byId('factoryCostStatus');
  const quickPrice = byId('factoryCostQuickPrice');
  const estimateDetail = byId('factoryCostEstimateDetail');
  const tierConfirmation = byId('factoryCostTierConfirmation');
  const adjustment = byId('factoryCostAdjust');
  const useUpperPrice = byId('factoryCostUseUpper');
  const table = byId('factoryCostTableWrap');
  const result = byId('factoryCostResult');
  const rows = byId('factoryCostRows');
  const weights = byId('factoryCostWeights');
  const weightEstimate = byId('factoryCostWeightEstimate');
  const saleHint = byId('factorySaleHint');
  const saleTable = byId('factorySaleTable');
  const saleRows = byId('factorySaleRows');
  const salePercent = byId('factorySalePercent');
  const salePercents = [200, 190, 180, 170];
  const addButton = byId('factoryCostAdd');
  const addStatus = byId('factoryCostAddStatus');
  const costCartRows = byId('factoryCostCartRows');
  const costCart = [];
  const sizeOptions = new Map();
  const confirmedTiers = new Map();
  let items = [];
  let catalog;
  let referenceRows = [];
  let loading = false;
  let tierEstimate = null;
  let tierRange = null;

  const normalize = value => value.normalize('NFKC').toLowerCase().replace(/[×＊*x]/g, 'x').replace(/\s+/g, '');
  const extractSize = value => value.match(/\d+(?:\.\d+)?\s*[×*x]\s*\d+(?:\.\d+)?\s*[×*x]\s*\d+(?:\.\d+)?/i)?.[0] || '';
  const selectedItem = () => item.value === '' ? undefined : items[Number(item.value)];
  const selectedPercent = () => Number(salePercent.querySelector('input:checked').value);
  const currencyFormat = (currency, maximumFractionDigits) => new Intl.NumberFormat('en-US', {
    style: 'currency', currency, currencyDisplay: 'code', maximumFractionDigits
  });
  const money = (value, currency, maximumFractionDigits = 2, upper = value) => {
    const format = currencyFormat(currency, maximumFractionDigits);
    const lowText = format.format(value);
    const highText = format.format(upper);
    if (upper === value || lowText === highText) return lowText;
    return format.formatRange?.(value, upper) ?? `${lowText}–${highText}`;
  };

  function readReferenceRows(groups) {
    return groups.flatMap((group, index) => group.tiers.map(tier => {
      // A size written beside a quantity applies to that row, rather than all sizes in the group.
      const noteSizes = tier.note.match(/\d+(?:\.\d+)?×\d+(?:\.\d+)?×\d+(?:\.\d+)?/g) || [];
      const heightNote = tier.note.startsWith('高度 ') ? tier.note : '';
      const sizes = (noteSizes.length ? noteSizes : group.sizes).map(dimension => ({
        key: [index, dimension, heightNote].join('|'),
        dimension,
        heightNote,
        label: [dimension, heightNote && `备注 ${heightNote}`, group.condition, `原表 #${group.label}`].filter(Boolean).join(' · ')
      }));
      return {group, tier, sizes};
    }));
  }

  function buildSizes(preferredSize) {
    sizeOptions.clear();
    if (supplier.value) {
      for (const {tier, sizes} of referenceRows) {
        if (!tier[supplier.value]) continue;
        for (const option of sizes) sizeOptions.set(option.key, option);
      }
    }
    size.disabled = !sizeOptions.size;
    size.replaceChildren(
      new Option(size.disabled ? '请先选择供应商' : '所有尺寸', ''),
      ...[...sizeOptions.values()].map(option => new Option(option.label, option.key))
    );
    if (!preferredSize) return;
    const matches = [...sizeOptions.values()].filter(option => !option.heightNote
      && normalize(option.dimension) === normalize(preferredSize));
    if (matches.length === 1) size.value = matches[0].key;
  }

  function adoptButton(original) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn btn-ghost';
    button.textContent = '带入原值';
    button.addEventListener('click', () => {
      tierEstimate = null;
      amount.value = original;
      basis.value = '';
      adjustment.open = true;
      renderComparison();
      basis.focus();
    });
    return button;
  }

  function canAdopt(tier, column, count) {
    return tier.quantity === String(count) && /^\d+(?:\.\d+)?$/.test(tier[column])
      && !tier.note.includes('尺寸留空');
  }

  function priceValuesAt(tier, column, count) {
    const quantities = tier.quantity.split('/');
    const prices = tier[column].split('/');
    return (quantities.length === prices.length ? [prices[quantities.indexOf(String(count))]] : prices)
      .filter(Boolean).map(value => value.trim());
  }

  function parsePrice(original) {
    const match = original?.match(/^(\d+(?:\.\d+)?)(?:\s*[-–—]\s*(\d+(?:\.\d+)?))?$/);
    if (!match) return null;
    const low = Number(match[1]);
    const high = Number(match[2] ?? match[1]);
    return Number.isFinite(high) && low > 0 && high >= low ? {low, high} : null;
  }

  function unitPriceAt(tier, column, count, confirmation) {
    const pricing = confirmation?.pricing ?? tier.estimateBasis?.[column];
    if (pricing !== 'batch' && pricing !== 'unit') return null;
    if (!confirmation && tier.quantity.split('/').length !== tier[column].split('/').length) return null;
    const original = confirmation?.original ?? priceValuesAt(tier, column, count)[0];
    const price = parsePrice(original);
    if (!price) return null;
    const divisor = pricing === 'batch' ? count : 1;
    return {unit: price.low / divisor, upper: price.high / divisor, pricing, original};
  }

  function tierKey(tier, count) {
    return [supplier.value, size.value, count, referenceRows.findIndex(row => row.tier === tier)].join('|');
  }

  function priceForTier(point, column) {
    if (point?.tiers.length !== 1) return null;
    const [tier] = point.tiers;
    return unitPriceAt(tier, column, point.count, confirmedTiers.get(tierKey(tier, point.count)));
  }

  function confirmablePrices(tier, column, count) {
    const values = priceValuesAt(tier, column, count).flatMap(value => {
      if (parsePrice(value)) return [value];
      const parts = value.split(/[–—-]/).map(part => part.trim());
      return parts.length > 2 && parts.every(part => parsePrice(part)) ? parts : [];
    });
    return [...new Set(values)];
  }

  function renderTierConfirmation(points, column) {
    const fields = [];
    for (const point of points) {
      if (point.tiers.length !== 1) continue;
      const [tier] = point.tiers;
      const values = confirmablePrices(tier, column, point.count);
      if (!values.length) continue;
      const priceSelect = document.createElement('select');
      const pricingSelect = document.createElement('select');
      priceSelect.id = `factoryCostTierPrice-${point.count}`;
      pricingSelect.id = `factoryCostTierBasis-${point.count}`;
      priceSelect.append(new Option('选择适用的原表价格', ''), ...values.map(value => new Option(value, value)));
      if (values.length === 1) priceSelect.value = values[0];
      pricingSelect.append(new Option('确认单价或整批价', ''), new Option('元/个', 'unit'), new Option('元/批', 'batch'));
      pricingSelect.value = tier.estimateBasis?.[column] || '';
      const group = document.createElement('div');
      group.className = 'cost-inputs';
      for (const [input, title] of [[priceSelect, `${point.count} 个档 · 原表 ${tier[column]}`], [pricingSelect, `${point.count} 个档计价口径`]]) {
        const wrapper = document.createElement('div');
        const label = document.createElement('label');
        label.htmlFor = input.id;
        label.textContent = title;
        wrapper.append(label, input);
        group.append(wrapper);
      }
      tierConfirmation.append(group);
      fields.push({key: tierKey(tier, point.count), priceSelect, pricingSelect});
    }
    if (!fields.length) return;
    tierConfirmation.hidden = false;
    const confirm = document.createElement('button');
    confirm.type = 'button';
    confirm.className = 'btn btn-ghost cost-reference-action';
    confirm.textContent = '确认档位并试算';
    const updateButton = () => {
      confirm.disabled = fields.some(({priceSelect, pricingSelect}) => !priceSelect.value || !pricingSelect.value);
    };
    for (const {priceSelect, pricingSelect} of fields) {
      priceSelect.addEventListener('change', updateButton);
      pricingSelect.addEventListener('change', updateButton);
    }
    confirm.addEventListener('click', () => {
      for (const {key, priceSelect, pricingSelect} of fields) {
        confirmedTiers.set(key, {original: priceSelect.value, pricing: pricingSelect.value});
      }
      resetComparison();
    });
    updateButton();
    tierConfirmation.append(confirm);
  }

  function adjacentPriceTiers(available, count) {
    const tiersByQuantity = new Map();
    for (const {tier} of available) {
      for (const quantity of tier.quantity.split('/').map(Number)) {
        if (!Number.isSafeInteger(quantity) || quantity < 1) continue;
        if (!tiersByQuantity.has(quantity)) tiersByQuantity.set(quantity, []);
        tiersByQuantity.get(quantity).push(tier);
      }
    }
    const quantities = [...tiersByQuantity.keys()].sort((a, b) => a - b);
    const lowerCount = quantities.findLast(quantity => quantity <= count);
    const upperCount = lowerCount === count ? undefined : quantities.find(quantity => quantity > count);
    const at = count => count === undefined ? null : {count, tiers: tiersByQuantity.get(count)};
    return {lower: at(lowerCount), upper: at(upperCount)};
  }

  function estimateUnitPrice(lower, upper, column, count) {
    const lowTier = priceForTier(lower, column);
    if (!lowTier || !upper) return lowTier;
    const highTier = priceForTier(upper, column);
    if (!highTier) return null;

    const fraction = (count - lower.count) / (upper.count - lower.count);
    const interpolate = (start, end) => Number((start + (end - start) * fraction).toPrecision(12));
    return {
      unit: interpolate(lowTier.unit, highTier.unit),
      upper: interpolate(lowTier.upper, highTier.upper),
      source: `${lower.count} 个档 ${money(lowTier.unit, 'CNY', 4, lowTier.upper)}/个，${upper.count} 个档 ${money(highTier.unit, 'CNY', 4, highTier.upper)}/个`
    };
  }

  function selectedWeight(chosen, count) {
    return chosen && !chosen.heightNote
      ? window.estimateWeightForDimensions('mailer_box', chosen.dimension, count) : null;
  }

  function fillEstimate(unit, tierLabel) {
    tierEstimate = {unit, tierLabel};
    amount.value = String(unit);
    basis.value = 'unit';
  }

  function renderReference() {
    if (!catalog) return;
    const column = supplier.value;
    const chosen = sizeOptions.get(size.value);
    const count = Number(quantity.value);
    const countGiven = quantity.value !== '' || quantity.validity.badInput;
    const validCount = Number.isSafeInteger(count) && count > 0;
    const available = referenceRows.filter(({tier, sizes}) =>
      (!column || tier[column]) && (!chosen || sizes.some(option => option.key === chosen.key)));
    const exact = validCount ? available.filter(({tier}) => tier.quantity.split('/').includes(String(count))) : [];
    const displayed = countGiven && exact.length ? exact : available;
    const fragment = document.createDocumentFragment();
    for (const {group, tier, sizes} of displayed) {
      const row = document.createElement('tr');
      const unitPrices = column ? tier.quantity.split('/').map(q => {
        const price = unitPriceAt(tier, column, Number(q));
        return price ? `${q} 个 ${money(price.unit, 'CNY', 4, price.upper)}/个` : '';
      }).filter(Boolean).join(' · ') : '';
      for (const value of [
        [`#${group.label} · ${sizes.map(option => option.dimension).join(' / ')}`, group.condition].filter(Boolean).join(' · '),
        tier.quantity, tier.doublePrint, tier.guohua, unitPrices, tier.note
      ]) {
        row.insertCell().textContent = value || '—';
      }
      const action = row.insertCell();
      if (chosen && validCount && canAdopt(tier, column, count)) action.append(adoptButton(tier[column]));
      fragment.append(row);
    }
    rows.replaceChildren(fragment);
    table.hidden = displayed.length === 0;
    const weightMatches = (catalog.weights || []).filter(entry =>
      !chosen || (!chosen.heightNote && normalize(entry.size) === normalize(chosen.dimension)));
    weights.hidden = weightMatches.length === 0;
    weights.textContent = weightMatches.length
      ? `原表另有称重记录（对应数量和包装口径待核） · ${weightMatches.map(entry => `${entry.size} cm / ${entry.weight}`).join('、')}`
      : '';
    weightEstimate.hidden = !chosen || !validCount;
    if (!weightEstimate.hidden) {
      const estimate = selectedWeight(chosen, count);
      weightEstimate.textContent = estimate
        ? `报价库整批参考重量 ${Number(estimate.kg.toFixed(3))} kg · ${estimate.detail}`
        : '报价库里没有该规格的可用重量记录，可用实际称重核算。';
    }
    const source = `${catalog.source} · 显示 ${displayed.length} 个数量档`;
    if (countGiven && !validCount) status.textContent = '请填写大于 0 的整数数量。';
    else if (countGiven && !exact.length) status.textContent = `${count} 个没有原表同数量记录。 · ${source}`;
    else status.textContent = source;

    tierRange = null;
    tierConfirmation.hidden = true;
    tierConfirmation.replaceChildren();
    useUpperPrice.hidden = true;
    quickPrice.textContent = '选择供应商、尺寸和数量后核对原表价格。';
    if (chosen && validCount) {
      const {lower, upper} = adjacentPriceTiers(available, count);
      const points = [lower, upper].filter(Boolean);
      const price = estimateUnitPrice(lower, upper, column, count);
      if (price) {
        const tierLabel = upper ? `${lower.count}–${upper.count}` : String(lower.count);
        const unit = `${money(price.unit, 'CNY', 4, price.upper)}/个`;
        if (price.upper > price.unit) tierRange = {...price, tierLabel};
        if (!amount.value) fillEstimate(price.upper, tierLabel);
        if (upper) {
          quickPrice.textContent = `${price.source}。按两档单价估算，${count} 个为 ${unit}。`;
        } else {
          const pricingLabel = price.pricing === 'batch' ? '暂按整批价折算' : '暂按单价';
          quickPrice.textContent = `参考 ${lower.count} 个档（${price.original} 元，${pricingLabel}），${unit} × ${count} 个。`;
        }
        const confirmedKeys = points.filter(point => point.tiers.length === 1)
          .map(point => tierKey(point.tiers[0], point.count)).filter(key => confirmedTiers.has(key));
        if (confirmedKeys.length) {
          const revise = document.createElement('button');
          revise.type = 'button';
          revise.className = 'btn btn-ghost cost-reference-action';
          revise.textContent = '重新选择档位';
          revise.addEventListener('click', () => {
            for (const key of confirmedKeys) confirmedTiers.delete(key);
            resetComparison();
          });
          tierConfirmation.hidden = false;
          tierConfirmation.append(revise);
        }
      } else if (lower && upper) {
        const originalPrices = [lower, upper].map(({count, tiers}) =>
          `${count} 个档：${tiers.map(tier => tier[column]).join(' / ')}`).join('，');
        quickPrice.textContent = `原表${originalPrices}。需确认是每个价还是整批价，才能估算 ${count} 个；也可直接填写已核实的价格。`;
      } else if (lower) {
        const originals = lower.tiers.map(tier => tier[column]).join(' / ');
        quickPrice.textContent = `原表 ${lower.count} 个档为 ${originals}。请核实后填写单价或本次整批价。`;
      } else {
        quickPrice.textContent = `${count} 个低于原表最低档，可填写已核实的出厂价。`;
      }
      if (!price && lower) {
        const unresolved = points.filter(point => !priceForTier(point, column));
        renderTierConfirmation(unresolved, column);
      }
      if (!price && exact.length === 1 && canAdopt(exact[0].tier, column, count)) {
        const original = exact[0].tier[column];
        if (!amount.value) {
          amount.value = original;
          quickPrice.textContent = `已填入原表金额 ${original}，请核实是单价还是整批价。`;
        }
      }
      if (!price) adjustment.open = true;
    }
    const hasEstimate = Boolean(tierEstimate);
    estimateDetail.textContent = hasEstimate ? quickPrice.textContent : '';
    estimateDetail.hidden = !hasEstimate;
    quickPrice.hidden = hasEstimate;
  }

  function renderSaleQuotes(cost, count, rate, upperCost = cost) {
    const maxSale = upperCost * 2;
    const validCost = Number.isFinite(maxSale);
    const validRate = Number.isFinite(rate) && rate > 0 && Number.isFinite(maxSale / rate);
    saleTable.hidden = !validCost;
    saleHint.hidden = !validCost && cost === undefined;
    if (!validCost) {
      saleRows.replaceChildren();
      saleHint.textContent = cost === undefined ? '' : '成本金额超出卖价计算范围。';
      return;
    }
    const fxHint = validRate
      ? `${count} 个 · 1 USD = ${rate} CNY`
      : `${count} 个 · 填写有效汇率后显示美元售价`;
    saleHint.textContent = upperCost > cost ? `参考售价区间 · ${fxHint}` : fxHint;
    const fragment = document.createDocumentFragment();
    const chosenPercent = selectedPercent();
    for (const percent of salePercents.filter(value => !chosenPercent || value === chosenPercent)) {
      const total = cost * (percent / 100);
      const upperTotal = upperCost * (percent / 100);
      const usd = validRate ? total / rate : null;
      const upperUsd = validRate ? upperTotal / rate : null;
      const row = document.createElement('tr');
      const label = document.createElement('th');
      label.scope = 'row';
      label.textContent = `${percent}%`;
      row.append(label);
      for (const value of [
        money(total / count, 'CNY', 4, upperTotal / count), money(total, 'CNY', 2, upperTotal),
        usd === null ? '—' : money(usd / count, 'USD', 4, upperUsd / count),
        usd === null ? '—' : money(usd, 'USD', 2, upperUsd)
      ]) {
        const cell = row.insertCell();
        cell.className = 'money';
        cell.textContent = value;
      }
      fragment.append(row);
    }
    saleRows.replaceChildren(fragment);
  }

  function currentCost() {
    const count = Number(quantity.value);
    const confirmed = Number(amount.value);
    if (!Number.isSafeInteger(count) || count < 1 || !Number.isFinite(confirmed) || confirmed <= 0 || !basis.value) return null;
    const referenceTier = basis.value === 'unit' && tierEstimate?.unit === confirmed ? tierEstimate.tierLabel : null;
    const usesUpperBound = Boolean(referenceTier && tierRange?.upper === confirmed);
    return {count, total: basis.value === 'unit' ? confirmed * count : confirmed, referenceTier, usesUpperBound};
  }

  function renderComparison() {
    const rate = Number(exchange.value);
    const cost = currentCost();
    addStatus.textContent = '';
    useUpperPrice.hidden = !tierRange || cost?.usesUpperBound === true;
    addButton.disabled = !cost || !Number.isFinite(cost.total * 2) || !sizeOptions.has(size.value)
      || !salePercents.includes(selectedPercent());
    if (!cost) {
      const count = Number(quantity.value);
      const enteredAmount = Number(amount.value);
      if (tierRange && !amount.value) {
        const low = tierRange.unit * count;
        const high = tierRange.upper * count;
        if (Number.isFinite(high * 2)) {
          result.textContent = `${count} 个 · 整批参考成本 ${money(low, 'CNY', 2, high)}`;
          renderSaleQuotes(low, count, rate, high);
          return;
        }
      }
      result.textContent = Number.isSafeInteger(count) && count > 0 && Number.isFinite(enteredAmount)
        && enteredAmount > 0 && !basis.value
        ? '请确认这笔出厂价是单价还是整批价。'
        : size.value && count > 0 ? '请核实出厂价和计价方式。' : '';
      renderSaleQuotes();
      return;
    }
    const {count, total, referenceTier, usesUpperBound} = cost;
    if (!Number.isFinite(total)) {
      result.textContent = '出厂成本金额超出计算范围。';
      renderSaleQuotes(total, count, rate);
      return;
    }
    const summary = [`${referenceTier ? '参考成本' : '成本'} ${money(total / count, 'CNY', 4)}/个`,
      `${count} 个合计 ${money(total, 'CNY')}`];
    if (usesUpperBound) summary.push('按区间上限试算');
    if (Number.isFinite(rate) && rate > 0 && Number.isFinite(total / rate)) {
      const usd = total / rate;
      summary.push(`折合 ${money(usd, 'USD')}`);
      const line = selectedItem();
      const chosen = sizeOptions.get(size.value);
      if (line?.qty === count && chosen && !chosen.heightNote
          && normalize(extractSize(line.size)) === normalize(chosen.dimension) && Number.isFinite(line.price)) {
        summary.push(`商品售价 ${money(line.price, 'USD')}`, `商品价差 ${money(line.price - usd, 'USD')}`);
      }
    } else {
      summary.push('填写有效汇率后可换算美元');
    }
    result.textContent = summary.join(' · ');
    renderSaleQuotes(total, count, rate);
  }

  function formatCartTotals(value) {
    if (!costCart.length) return '—';
    const rate = Number(exchange.value);
    const usd = value / rate;
    return Number.isFinite(rate) && rate > 0 && Number.isFinite(usd)
      ? `${money(value, 'CNY')} · ${money(usd, 'USD')}` : money(value, 'CNY');
  }

  function updateFreight(amountUsd, status) {
    const rate = Number(exchange.value);
    const validRate = Number.isFinite(rate) && rate > 0;
    const goods = costCart.reduce((total, entry) => total + entry.sale, 0);
    const amountCny = amountUsd * rate;
    byId('factoryCostCartFreight').textContent = status || (validRate
      ? `${money(amountCny, 'CNY')} · ${money(amountUsd, 'USD')}` : money(amountUsd, 'USD'));
    byId('factoryCostCartTotal').textContent = !costCart.length ? '—'
      : status || (validRate ? formatCartTotals(goods + amountCny) : '请确认汇率');
  }

  function renderCostCart() {
    if (!costCartRows) return;
    const rate = Number(exchange.value);
    const validRate = Number.isFinite(rate) && rate > 0;
    const fragment = document.createDocumentFragment();
    for (const [index, entry] of costCart.entries()) {
      const row = document.createElement('tr');
      for (const value of [
        `飞机盒 · ${entry.dimension}`, entry.supplier, String(entry.count),
        entry.weight === null ? '待称重' : `${Number(entry.weight.toFixed(3))} kg`,
        `${money(entry.cost, 'CNY')}${entry.referenceTier ? `（参考 ${entry.referenceTier} 个档${entry.usesUpperBound ? '上限' : ''}）` : ''}`,
        `${money(entry.sale, 'CNY')} · ${entry.percent}%`
      ]) row.insertCell().textContent = value;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'btn btn-danger';
      remove.textContent = '删除';
      remove.setAttribute('aria-label', `删除 ${entry.supplier} ${entry.dimension}`);
      remove.addEventListener('click', () => {
        costCart.splice(index, 1);
        addStatus.textContent = '';
        renderCostCart();
        window.refreshQuoteLogistics();
      });
      row.insertCell().append(remove);
      fragment.append(row);
    }
    costCartRows.replaceChildren(fragment);
    byId('factoryCostCartEmpty').hidden = costCart.length > 0;
    byId('factoryCostCartTable').hidden = costCart.length === 0;
    const cost = costCart.reduce((total, entry) => total + entry.cost, 0);
    const sale = costCart.reduce((total, entry) => total + entry.sale, 0);
    byId('factoryCostCartCount').textContent = costCart.length;
    byId('factoryCostCartCost').textContent = formatCartTotals(cost);
    byId('factoryCostCartSale').textContent = formatCartTotals(sale);
    byId('factoryCostCartDifference').textContent = formatCartTotals(sale - cost);
    byId('factoryCostCartExchange').textContent = validRate
      ? `按 1 USD = ${rate} CNY 换算。额外工艺费和税费按实际条件另核。`
      : '填写物流区汇率后可查看美元金额。额外工艺费和税费按实际条件另核。';
  }

  addButton.addEventListener('click', () => {
    if (addButton.disabled) return;
    const {count, total, referenceTier, usesUpperBound} = currentCost();
    const chosen = sizeOptions.get(size.value);
    const percent = selectedPercent();
    const roundCny = value => Math.round((value + Number.EPSILON) * 100) / 100;
    const entry = {
      supplier: supplier.selectedOptions[0].textContent,
      dimension: chosen.label,
      size: chosen.dimension,
      count,
      cost: roundCny(total),
      sale: roundCny(total * (percent / 100)),
      percent,
      referenceTier,
      usesUpperBound,
      weight: selectedWeight(chosen, count)?.kg ?? null
    };
    if (catalogFile) window.addImportedFactoryQuote(entry);
    else costCart.push(entry);
    addStatus.textContent = '已添加到成本报价单。';
    renderCostCart();
    if (!catalogFile) window.refreshQuoteLogistics();
  });

  useUpperPrice.addEventListener('click', () => {
    if (!tierRange) return;
    fillEstimate(tierRange.upper, tierRange.tierLabel);
    renderComparison();
  });

  function resetComparison() {
    amount.value = '';
    basis.value = '';
    tierEstimate = null;
    renderReference();
    renderComparison();
  }

  item.addEventListener('change', () => {
    const line = selectedItem();
    buildSizes(line && extractSize(line.size));
    quantity.value = line?.qty ?? '';
    resetComparison();
  });
  supplier.addEventListener('change', () => {
    const line = selectedItem();
    buildSizes(line && extractSize(line.size));
    resetComparison();
  });
  size.addEventListener('change', resetComparison);
  quantity.addEventListener('input', resetComparison);
  for (const input of [amount, basis, exchange]) input.addEventListener('input', renderComparison);
  exchange.addEventListener('input', renderCostCart);
  salePercent.addEventListener('change', renderComparison);

  window.factoryCostReview = {
    freightItems() {
      return costCart.map(entry => ({
        product: `飞机盒 · ${entry.supplier}`, size: entry.dimension, qty: entry.count,
        price: entry.sale, addon: 0, weight: entry.weight
      }));
    },
    updateFreight,
    showView: showCostView,
    updateItems(cart) {
      const selected = selectedItem();
      items = cart.filter(line => line.productId === 'mailer_box');
      importQuote.hidden = items.length === 0;
      const independent = new Option('独立查成本', '');
      item.replaceChildren(independent, ...items.map((line, index) =>
        new Option(`${line.size} · ${line.qty} 个`, String(index))));
      const index = items.indexOf(selected);
      item.value = index < 0 ? '' : String(index);
      if (selected && index < 0) resetComparison();
    }
  };

  function showCostView(active) {
    salesView.hidden = active;
    panel.hidden = !active;
    salesButton.setAttribute('aria-pressed', String(!active));
    costButton.setAttribute('aria-pressed', String(active));
    window.showQuoteLogistics(active);
    if (active) {
      renderCostCart();
      renderComparison();
      void loadCatalog();
    }
  }

  function installCatalog(data) {
    if (data?.kind !== 'factory_cost_reference' || !Array.isArray(data.groups)
        || !data.groups.length || !data.groups.every(group =>
          Array.isArray(group?.sizes) && group.sizes.every(size => typeof size === 'string')
          && Array.isArray(group.tiers) && group.tiers.every(tier =>
            typeof tier?.quantity === 'string' && typeof tier.note === 'string'
            && typeof tier.doublePrint === 'string' && typeof tier.guohua === 'string'))
        || (data.weights != null && (!Array.isArray(data.weights)
          || !data.weights.every(weight => typeof weight?.size === 'string')))) {
      throw new Error('Invalid cost catalog');
    }
    referenceRows = readReferenceRows(data.groups);
    confirmedTiers.clear();
    if (catalogFile) {
      for (const [key, fallback] of supplierDefaults) {
        if (!key) continue;
        const label = data.supplierLabels?.[key];
        const option = [...supplier.options].find(entry => entry.value === key);
        option.textContent = typeof label === 'string' && label.trim() ? label.trim().slice(0, 80) : fallback;
        const heading = byId(`factoryCostSupplierHeading-${key}`);
        if (heading) heading.textContent = option.textContent;
      }
    }
    catalog = data;
    const line = selectedItem();
    buildSizes(line && extractSize(line.size));
    resetComparison();
  }

  async function loadCatalog() {
    if (catalogFile || catalog || loading) return;
    loading = true;
    status.textContent = '正在读取本机成本库…';
    quickPrice.textContent = '正在读取本机成本库…';
    try {
      const response = await fetch('data/factory-cost/mailer-box.json', {cache: 'no-store'});
      if (!response.ok) throw new Error('Cost catalog unavailable');
      installCatalog(await response.json());
      byId('factoryCostSource').hidden = false;
    } catch {
      catalog = undefined;
      status.textContent = '本机成本库暂未加载，可重新打开成本计算器或原表。';
      quickPrice.textContent = status.textContent;
    } finally {
      loading = false;
    }
  }

  catalogFile?.addEventListener('change', async () => {
    const file = catalogFile.files[0];
    if (!file) return;
    const result = byId('factoryCostImportStatus');
    catalogFile.disabled = true;
    try {
      if (file.size > 1024 * 1024) throw new Error('Cost catalog too large');
      installCatalog(JSON.parse(await file.text()));
      byId('factoryCostCatalogFields').hidden = false;
      reference.hidden = false;
      result.textContent = '内部成本表已导入，可选择供应商、规格和数量。';
    } catch {
      result.textContent = '无法读取成本表，请选择从本机工作台下载的 JSON 文件。';
    } finally {
      catalogFile.value = '';
      catalogFile.disabled = false;
    }
  });

  costButton.hidden = false;
  salesButton.addEventListener('click', () => showCostView(false));
  costButton.addEventListener('click', () => showCostView(true));
  reference.addEventListener('toggle', () => {
    if (reference.open) void loadCatalog();
  });
})();
