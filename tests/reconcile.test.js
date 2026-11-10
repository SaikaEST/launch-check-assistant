'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {parseTable, analyze, compareStats, toNum, round} = require('../assets/reconcile');

const baseMap = {id: 0, qty: 1};
function stats(text, map = baseMap) { return analyze(parseTable(text), map); }

test('quoted CSV preserves comma, escaped quote, multiline cell, BOM and trailing empty value', () => {
  const table = parseTable('\uFEFF单据号,金额,说明\r\nD1,"1,234.50","说明""一""\r\n续行"\r\nD2,0,\r\n');
  assert.deepEqual(table.headers, ['单据号', '金额', '说明']);
  assert.deepEqual(table.rows, [['D1', '1,234.50', '说明"一"\n续行'], ['D2', '0', '']]);
  assert.equal(table.cols, 3);
  assert.equal(stats('单号,金额\nD1,"1,234.50"').posSum, 1234.5);
});

test('TSV supports Excel quoted multiline and comma content', () => {
  const table = parseTable('单号\t金额\t说明\nD1\t10\t"a,b\n第二行"');
  assert.deepEqual(table.rows, [['D1', '10', 'a,b\n第二行']]);
  assert.deepEqual(parseTable('\n\n单号\t金额\nD1\t10').rows, [['D1', '10']]);
});

test('no-header mode and blank physical lines do not lose explicit empty records', () => {
  const table = parseTable('\n\nD1,10\n,\n\nD2,\n', false);
  assert.deepEqual(table.headers, ['第1列', '第2列']);
  assert.deepEqual(table.rows, [['D1', '10'], ['', ''], ['D2', '']]);
});

test('malformed quoted data fails with a clear error instead of silently splitting rows', () => {
  assert.throws(() => parseTable('单号,金额\nD1,"12'), /未闭合/);
  assert.throws(() => parseTable('单号,金额\nD1,"12"x'), /非法字符/);
  assert.throws(() => parseTable('单号,金额\nD1,1"2'), /单元格开头/);
});

test('finite decimal values, zero, blank and malformed numbers remain distinct', () => {
  const result = stats('单号,金额\nD1,0\nD2,\nD3,Infinity\nD4,NaN\nD5,abc\nD6,-12.50\nD7,￥25.5');
  assert.equal(result.zero, 1);
  assert.equal(result.empty, 1);
  assert.equal(result.invalid, 3);
  assert.equal(result.posSum, 25.5);
  assert.equal(result.negSum, -12.5);
  assert.equal(result.recs[1].valueState, 'empty');
  assert.equal(result.recs[2].valueState, 'invalid');
  assert.equal(toNum('1e999'), null);
  assert.equal(toNum('1e-999'), null);
  assert.equal(toNum('0x10'), null);
  assert.equal(toNum('12,34'), null);
  assert.equal(toNum('1 2'), null);
  assert.equal(toNum('-0'), 0);
});

test('same document in different ships or professions cannot cancel out', () => {
  const map = {id: 0, qty: 1, project: 2, dept: 3};
  const source = stats('单号,金额,船次,专业\nD1,100,S1,机电\nD1,200,S2,管系', map);
  const system = stats('单号,金额,船次,专业\nD1,200,S1,机电\nD1,100,S2,管系', map);
  const compared = compareStats(source, system);
  assert.equal(compared.mismatch.length, 2);
  assert.equal(source.dupIds, 0);
  assert.match(compared.mismatch[0].label, /船次 \/ 工程：S1/);
});

test('source and system may use different column orders but matching semantic maps', () => {
  const source = stats('单号,金额,船次,专业,施工队,期间,行号\nD1,10,S1,P1,T1,2026-10,1',
    {id: 0, qty: 1, project: 2, dept: 3, team: 4, period: 5, line: 6});
  const system = stats('金额,施工队,行号,专业,期间,单号,船次\n10,T1,1,P1,2026-10,D1,S1',
    {id: 5, qty: 0, project: 6, dept: 3, team: 1, period: 4, line: 2});
  assert.deepEqual(compareStats(source, system), {missing: [], extra: [], mismatch: []});
});

test('wrong ship, period, team or detail line is a missing and an extra combination', () => {
  const map = {id: 0, qty: 1, project: 2, period: 3, team: 4, line: 5};
  const source = stats('单号,金额,船次,期间,施工队,行号\nD1,10,S1,2026-10,T1,1', map);
  const system = stats('单号,金额,船次,期间,施工队,行号\nD1,10,S2,2026-11,T2,2', map);
  const compared = compareStats(source, system);
  assert.equal(compared.missing.length, 1);
  assert.equal(compared.extra.length, 1);
});

test('blank dimensions keep their field position and do not collapse to a different group', () => {
  const result = stats('单号,金额,船次,专业\nD1,10,,机电\nD1,10,机电,', {id: 0, qty: 1, project: 2, dept: 3});
  assert.equal(result.uniq, 2);
  assert.equal(result.groups.size, 2);
  assert.equal(result.missingDimensions, 2);
  assert.match([...result.groups.values()][0].label, /船次 \/ 工程：（空）/);
});

test('compound keys preserve identifiers with separators and empty values', () => {
  const map = {id: 0, qty: 1, project: 2, dept: 3};
  const result = stats('单号\t金额\t船次\t专业\nD1\t10\tA / B\tC\nD1\t10\tA\tB / C', map);
  assert.equal(result.uniq, 2);
  assert.equal(result.groups.size, 2);
  const ambiguous = stats('单号\t金额\t船次\t专业\nD1\t10\tA | 专业：B\tC\nD1\t10\tA\tB | 专业：C\nD1\t10\t（空）\t\nD1\t10\t\t', map);
  assert.equal(ambiguous.groups.size, 4);
});

test('equal net total does not hide different positive and negative lines', () => {
  const source = stats('单号,金额\nD1,100\nD1,-100');
  const system = stats('单号,金额\nD1,50\nD1,-50');
  const compared = compareStats(source, system);
  assert.equal(compared.mismatch.length, 1);
  assert.equal(compared.mismatch[0].diff, 0);
  assert.match(compared.mismatch[0].reason, /正负合计不同/);
});

test('equal sign totals and row counts still reveal different row values', () => {
  const source = stats('单号,金额\nD1,10\nD1,20');
  const system = stats('单号,金额\nD1,15\nD1,15');
  assert.match(compareStats(source, system).mismatch[0].reason, /明细数值分布不同/);
});

test('blank amount never equals zero, including mixed rows with equal total', () => {
  const source = stats('单号,金额\nD1,\nD1,10');
  const system = stats('单号,金额\nD1,0\nD1,10');
  const compared = compareStats(source, system);
  assert.equal(compared.mismatch.length, 1);
  assert.match(compared.mismatch[0].reason, /空值行数不同/);
});

test('identical multiple rows may legitimately share one document key', () => {
  const source = stats('单号,金额\nD1,10\nD1,20');
  const system = stats('单号,金额\nD1,20\nD1,10');
  assert.equal(source.dupIds, 1);
  assert.equal(source.dupRows, 1);
  assert.deepEqual(compareStats(source, system), {missing: [], extra: [], mismatch: []});
});

test('row count differences do not disappear when an extra zero row is inserted', () => {
  const source = stats('单号,金额\nD1,10');
  const system = stats('单号,金额\nD1,10\nD1,0');
  assert.match(compareStats(source, system).mismatch[0].reason, /明细行数不同/);
});

test('chosen precision applies to individual values and totals', () => {
  const source = stats('单号,金额\nD1,10.001');
  const system = stats('单号,金额\nD1,10.004');
  assert.equal(compareStats(source, system).mismatch.length, 0);
  assert.equal(compareStats(source, system, {precision: 3}).mismatch.length, 1);
  assert.throws(() => compareStats(source, system, {precision: -1}), /精度/);
});

test('half-cent rounding is symmetric and is not affected by floating point representation', () => {
  assert.equal(round(1.005), 1.01);
  assert.equal(round(-1.005), -1.01);
  assert.equal(round(1.005, 3), 1.005);
  assert.equal(round(2.5, 0), 3);
  assert.equal(round(-2.5, 0), -3);
  assert.equal(Object.is(round(-0.001), -0), false);
  assert.throws(() => round(Infinity), /有限数值/);
  assert.throws(() => round(1, 9), /精度/);
  assert.equal(compareStats(stats('单号,金额\nD1,1.005'), stats('单号,金额\nD1,1.01')).mismatch.length, 0);
  assert.equal(compareStats(stats('单号,金额\nD1,-1.005'), stats('单号,金额\nD1,-1.01')).mismatch.length, 0);
  const values = stats('单号,金额\nD1,0.1\nD1,0.2\nD1,0.705\nD1,-0.1\nD1,-0.2');
  assert.equal(values.posSum, 1.005);
  assert.equal(values.negSum, -0.3);
  assert.equal([...values.groups.values()][0].sum, 0.705);
});

test('decimal inputs that lose significant digits when parsed are invalid, never rounded into false matches', () => {
  const result = stats('单号,金额\nD1,9007199254740990.1\nD2,1.0000000000000001\nD3,123456789012345.123');
  assert.equal(result.invalid, 3);
  assert.equal(result.posSum, 0);
  assert.equal(toNum('9007199254740990.1'), null);
  assert.equal(toNum('0.1000000000000000'), 0.1);
  assert.equal(toNum('01.200e1'), 12);
  assert.equal(toNum('-0.000e20'), 0);
});

test('unsafe or unrepresentable decimal totals fail clearly before a result is displayed', () => {
  assert.throws(() => stats('单号,金额\nD1,9007199254740991\nD1,1'), /合计超出安全数值/);
  assert.throws(() => stats('单号,金额\nD1,-9007199254740991\nD1,-1'), /合计超出安全数值/);
  assert.throws(() => stats('单号,金额\nD1,9007199254740990\nD1,0.1'), /合计超出安全数值/);
  assert.throws(() => stats('单号,金额\nD1,9007199254740991\nD2,1'), /合计超出安全数值/);
  assert.equal(stats('单号,金额\nD1,0.1\nD1,0.2').posSum, 0.3);
});

test('missing identifiers and invalid fields are reported, mapping mistakes fail explicitly', () => {
  const result = stats('单号,金额\n,10\nD1,bad');
  assert.equal(result.noId, 1);
  assert.equal(result.invalid, 1);
  assert.equal(result.uniq, 1);
  assert.throws(() => stats('单号,金额\nD1,10', {id: 0, qty: 0}), /同一列/);
  assert.throws(() => stats('单号,金额\nD1,10', {id: 0, qty: 3}), /列无效/);
});

test('different dimension selections cannot silently produce an apparently matching result', () => {
  const source = stats('单号,金额,船次\nD1,10,S1', {id: 0, qty: 1, project: 2});
  const system = stats('单号,金额,船次\nD1,10,S1');
  assert.throws(() => compareStats(source, system), /相同的业务维度/);
});
