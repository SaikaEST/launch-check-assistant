/* Standalone reconciliation helpers; no browser or network state required. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.Reconcile = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const DIMENSIONS = [
    ['project', '船次 / 工程'], ['dept', '专业'], ['period', '期间'],
    ['team', '施工队'], ['line', '明细行号']
  ];

  function parseTable(text, withHeader = true) {
    const input = String(text == null ? '' : text).replace(/^\uFEFF/, '');
    if (!input.trim()) return {headers: [], rows: [], cols: 0};

    // Choose the delimiter from the first logical row, ignoring quoted cells.
    let quoted = false, delimiter = ',', quoteStart = true, firstRowTouched = false;
    for (let i = 0; i < input.length; i++) {
      const c = input[i];
      if (c === '"') {
        firstRowTouched = true;
        if (quoted && input[i + 1] === '"') { i++; continue; }
        if (quoted || quoteStart) quoted = !quoted;
      } else if (!quoted) {
        if (c === '\t') { delimiter = '\t'; break; }
        if (c === '\n' || c === '\r') {
          if (firstRowTouched) break;
          quoteStart = true;
        } else if (c === ',') { quoteStart = true; firstRowTouched = true; }
        else if (!/\s/.test(c)) { quoteStart = false; firstRowTouched = true; }
      }
    }

    const cells = [];
    let row = [], value = '', inQuotes = false, afterQuote = false, line = 1;
    let rowTouched = false, fieldQuoted = false;
    function finishField() {
      row.push(value.trim());
      value = ''; afterQuote = false; fieldQuoted = false;
    }
    function finishRow() {
      finishField();
      // Ignore blank physical lines, but keep explicitly empty records (e.g. , or "").
      if (rowTouched || row.some(v => v !== '')) cells.push(row);
      row = []; rowTouched = false;
    }
    for (let i = 0; i < input.length; i++) {
      const c = input[i];
      if (inQuotes) {
        if (c === '"') {
          if (input[i + 1] === '"') { value += '"'; i++; }
          else { inQuotes = false; afterQuote = true; }
        } else if (c === '\r' || c === '\n') {
          if (c === '\r' && input[i + 1] === '\n') i++;
          value += '\n'; line++;
        } else value += c;
        continue;
      }
      if (c === delimiter) {
        rowTouched = true; finishField();
      } else if (c === '\r' || c === '\n') {
        if (c === '\r' && input[i + 1] === '\n') i++;
        finishRow(); line++;
      } else if (afterQuote) {
        if (!/\s/.test(c)) throw new Error('第 ' + line + ' 行：引号结束后存在非法字符');
      } else if (c === '"') {
        if (value.trim() !== '' || fieldQuoted) throw new Error('第 ' + line + ' 行：引号必须从单元格开头开始');
        value = ''; inQuotes = true; fieldQuoted = true; rowTouched = true;
      } else {
        value += c;
        if (!/\s/.test(c)) rowTouched = true;
      }
    }
    if (inQuotes) throw new Error('第 ' + line + ' 行：存在未闭合的引号');
    if (row.length || value !== '' || rowTouched) finishRow();
    if (!cells.length) return {headers: [], rows: [], cols: 0};

    let cols = 0;
    cells.forEach(r => { cols = Math.max(cols, r.length); });
    const headers = withHeader ? cells.shift().slice() : [];
    while (headers.length < cols) headers.push('第' + (headers.length + 1) + '列');
    const rows = cells.map(r => r.concat(Array(Math.max(0, cols - r.length)).fill('')));
    return {headers, rows, cols};
  }

  function canonicalDecimal(text) {
    const parts = String(text).toLowerCase().split('e');
    const negative = parts[0][0] === '-';
    const decimal = parts[0].replace(/^[+-]/, '').split('.');
    let digits = (decimal[0] + (decimal[1] || '')).replace(/^0+/, '');
    if (!digits) return '0';
    const significant = digits.replace(/0+$/, '');
    const exponent = Number(parts[1] || 0) - (decimal[1] || '').length + digits.length - significant.length;
    return (negative ? '-' : '') + significant + 'e' + exponent;
  }

  function numericValue(value) {
    const raw = String(value == null ? '' : value).trim();
    if (raw === '') return {value: null, state: 'empty', raw};
    let s = raw.replace(/^[¥￥]\s*/, '').replace(/，/g, ',');
    // Accept plain decimal / scientific notation and properly grouped thousands.
    if (!/^[+-]?(?:(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(s)) {
      return {value: null, state: 'invalid', raw};
    }
    s = s.replace(/,/g, '');
    const n = Number(s);
    if (!Number.isFinite(n) || Math.abs(n) > Number.MAX_SAFE_INTEGER || canonicalDecimal(s) !== canonicalDecimal(n)) {
      return {value: null, state: 'invalid', raw};
    }
    return {value: Object.is(n, -0) ? 0 : n, state: 'number', raw};
  }

  function toNum(value) { return numericValue(value).value; }

  // Decimal integer rounding avoids floating point half-cent surprises (1.005).
  function quantize(value, precision) {
    const negative = value < 0;
    const parts = Math.abs(value).toString().toLowerCase().split('e');
    const decimal = parts[0].split('.');
    const digits = (decimal[0] + (decimal[1] || '')).replace(/^0+(?=\d)/, '');
    const shift = Number(parts[1] || 0) - (decimal[1] || '').length + precision;
    let result = BigInt(digits || '0');
    if (shift >= 0) result *= 10n ** BigInt(shift);
    else {
      const divisor = 10n ** BigInt(-shift);
      result = (result + divisor / 2n) / divisor;
    }
    return negative ? -result : result;
  }

  function validatePrecision(precision) {
    if (!Number.isInteger(precision) || precision < 0 || precision > 8) throw new Error('核对精度应为 0 至 8 位小数');
  }

  function round(value, precision = 2) {
    validatePrecision(precision);
    if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER) {
      throw new Error('待舍入值必须是安全范围内的有限数值');
    }
    return Number(quantize(value, precision).toString() + 'e-' + precision);
  }

  function decimalSum(values) {
    let total = 0n, exponent = 0;
    values.forEach(value => {
      if (value === 0) return;
      const parts = Math.abs(value).toString().toLowerCase().split('e');
      const decimal = parts[0].split('.');
      let units = BigInt(decimal[0] + (decimal[1] || '')) * (value < 0 ? -1n : 1n);
      const valueExponent = Number(parts[1] || 0) - (decimal[1] || '').length;
      if (valueExponent < exponent) {
        total *= 10n ** BigInt(exponent - valueExponent);
        exponent = valueExponent;
      } else units *= 10n ** BigInt(valueExponent - exponent);
      total += units;
    });
    const exact = total.toString() + 'e' + exponent;
    const result = Number(exact);
    if (!Number.isFinite(result) || Math.abs(result) > Number.MAX_SAFE_INTEGER || canonicalDecimal(exact) !== canonicalDecimal(result)) {
      throw new Error('合计超出安全数值或可表示精度范围，请缩小核对范围或提高源数据的数值规范性');
    }
    return result;
  }

  function finalizeBucket(bucket) {
    bucket.sum = decimalSum(bucket.values);
    bucket.pos = decimalSum(bucket.values.filter(value => value > 0));
    bucket.neg = decimalSum(bucket.values.filter(value => value < 0));
  }

  function selectedDimensions(map) {
    return DIMENSIONS.filter(([key]) => Number.isInteger(map[key]) && map[key] >= 0);
  }

  function emptyBucket(label) {
    return {label, rows: 0, sum: 0, pos: 0, neg: 0, posRows: 0, negRows: 0,
      zero: 0, empty: 0, invalid: 0, values: [], invalidValues: []};
  }

  function addToBucket(bucket, rec) {
    bucket.rows++;
    if (rec.valueState === 'empty') bucket.empty++;
    else if (rec.valueState === 'invalid') { bucket.invalid++; bucket.invalidValues.push(rec.rawQty); }
    else {
      bucket.values.push(rec.qty);
      bucket.sum += rec.qty;
      if (rec.qty > 0) { bucket.posRows++; bucket.pos += rec.qty; }
      else if (rec.qty < 0) { bucket.negRows++; bucket.neg += rec.qty; }
      else bucket.zero++;
    }
  }

  function analyze(table, map) {
    if (!table || !Array.isArray(table.rows) || !map) throw new Error('缺少明细表或列对应关系');
    const entries = [['id', '单据号'], ['qty', '数量 / 金额']].concat(DIMENSIONS);
    const used = new Set();
    entries.forEach(([key, label]) => {
      const idx = map[key];
      const required = key === 'id' || key === 'qty';
      if (!required && (idx == null || idx === -1)) return;
      if (!Number.isInteger(idx) || idx < 0 || (table.rows.length && idx >= table.cols)) {
        throw new Error(label + '列无效，请检查列对应关系');
      }
      if (used.has(idx)) throw new Error('同一列不能同时映射到多个字段：' + label);
      used.add(idx);
    });

    const dims = selectedDimensions(map);
    const recs = table.rows.map((row, index) => {
      const numeric = numericValue(row[map.qty]);
      const rec = {id: String(row[map.id] == null ? '' : row[map.id]).trim(), qty: numeric.value,
        rawQty: numeric.raw, valueState: numeric.state, row: index + 1};
      DIMENSIONS.forEach(([key]) => { rec[key] = map[key] >= 0 ? String(row[map[key]] == null ? '' : row[map[key]]).trim() : ''; });
      rec.key = JSON.stringify([rec.id].concat(dims.map(([key]) => rec[key])));
      rec.label = rec.id + dims.map(([key, label]) => ' | ' + label + '：' + (rec[key] || '（空）')).join('');
      return rec;
    });
    const st = {rows: recs.length, recs, posRows: 0, posSum: 0, negRows: 0, negSum: 0,
      zero: 0, empty: 0, invalid: 0, noId: 0, uniq: 0, dupIds: 0, dupRows: 0,
      missingDimensions: 0, ids: new Map(), totals: new Map(), labels: new Map(),
      groups: new Map(), groupLabels: new Map(), buckets: new Map(), dimensions: dims.map(([key]) => key)};

    recs.forEach(rec => {
      if (!rec.id) st.noId++;
      else {
        st.ids.set(rec.key, (st.ids.get(rec.key) || 0) + 1);
        st.labels.set(rec.key, rec.label);
        const bucket = st.buckets.get(rec.key) || emptyBucket(rec.label);
        addToBucket(bucket, rec);
        st.buckets.set(rec.key, bucket);
        st.totals.set(rec.key, bucket.sum);
      }
      if (dims.some(([key]) => rec[key] === '')) st.missingDimensions++;
      if (rec.valueState === 'empty') st.empty++;
      else if (rec.valueState === 'invalid') st.invalid++;
      else if (rec.qty > 0) { st.posRows++; st.posSum += rec.qty; }
      else if (rec.qty < 0) { st.negRows++; st.negSum += rec.qty; }
      else st.zero++;

      const groupDims = dims.filter(([key]) => key !== 'line');
      const groupKey = JSON.stringify(groupDims.map(([key]) => rec[key]));
      const groupLabel = groupDims.map(([key, label]) => label + '：' + (rec[key] || '（空）')).join(' | ') || '全部';
      const group = st.groups.get(groupKey) || emptyBucket(groupLabel);
      addToBucket(group, rec);
      st.groups.set(groupKey, group);
      st.groupLabels.set(groupKey, groupLabel);
    });
    st.buckets.forEach((bucket, key) => { finalizeBucket(bucket); st.totals.set(key, bucket.sum); });
    st.groups.forEach(finalizeBucket);
    st.posSum = decimalSum(recs.filter(rec => rec.valueState === 'number' && rec.qty > 0).map(rec => rec.qty));
    st.negSum = decimalSum(recs.filter(rec => rec.valueState === 'number' && rec.qty < 0).map(rec => rec.qty));
    st.uniq = st.ids.size;
    st.ids.forEach(n => { if (n > 1) { st.dupIds++; st.dupRows += n - 1; } });
    return st;
  }

  function numericMultiset(values, precision) {
    return values.map(v => quantize(v, precision).toString()).sort();
  }

  function equalArrays(a, b) {
    return a.length === b.length && a.every((value, index) => value === b[index]);
  }

  function compareStats(source, system, options = {}) {
    const precision = options.precision == null ? 2 : options.precision;
    validatePrecision(precision);
    if (!equalArrays(source.dimensions, system.dimensions)) throw new Error('两份明细必须使用相同的业务维度');
    const missing = [], extra = [], mismatch = [];
    source.buckets.forEach((a, key) => {
      const b = system.buckets.get(key);
      if (!b) {
        missing.push({id: a.label, label: a.label, key, qty: a.sum, rows: a.rows, empty: a.empty, invalid: a.invalid});
        return;
      }
      const reasons = [];
      if (a.rows !== b.rows) reasons.push('明细行数不同');
      if (a.empty !== b.empty) reasons.push('空值行数不同');
      if (a.invalid !== b.invalid || !equalArrays(a.invalidValues.slice().sort(), b.invalidValues.slice().sort())) reasons.push('非法数值不同');
      if (a.zero !== b.zero) reasons.push('真实零值行数不同');
      if (a.posRows !== b.posRows || a.negRows !== b.negRows) reasons.push('正负数行数不同');
      if (quantize(a.pos, precision) !== quantize(b.pos, precision) || quantize(a.neg, precision) !== quantize(b.neg, precision)) reasons.push('正负合计不同');
      if (!equalArrays(numericMultiset(a.values, precision), numericMultiset(b.values, precision))) reasons.push('明细数值分布不同');
      if (reasons.length) mismatch.push({id: a.label, label: a.label, key, src: a.sum, sys: b.sum,
        diff: b.sum - a.sum, reason: reasons.join('；'), srcRows: a.rows, sysRows: b.rows});
    });
    system.buckets.forEach((b, key) => {
      if (!source.buckets.has(key)) extra.push({id: b.label, label: b.label, key, qty: b.sum, rows: b.rows, empty: b.empty, invalid: b.invalid});
    });
    return {missing, extra, mismatch};
  }

  return {parseTable, analyze, compareStats, toNum, round};
});
