'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Readiness = require('../assets/readiness.js');

function item(patch) {
  return Object.assign({id: 'check-1', category: 'rule', status: '待处理', critical: false}, patch);
}

function confirmedRule(patch) {
  return item(Object.assign({critical: true, status: '通过', confirmOwner: '现场确认人', basis: '本项目口径确认单第 2 条', evidence: '已签字的口径确认单.pdf'}, patch));
}

function closedIssue(patch) {
  return item(Object.assign({category: 'issue', severity: '严重', status: '通过', retest: '通过', history: '已处理', impact: '否'}, patch));
}

test('empty and fully exempt ledgers have no applicable checks and cannot appear completed', function () {
  for (const items of [[], [item({status: '不适用', naReason: '本次上线不涉及此模块'})]]) {
    const result = Readiness.evaluate(items);
    assert.equal(result.reviewState, 'insufficient');
    assert.equal(result.rate, 0);
    assert.equal(result.applicable, 0);
    assert.equal(result.open, 0);
    assert.ok(result.reviewMessage);
  }
});

test('an exemption without a written reason remains a blocker, including noncritical checks', function () {
  const result = Readiness.evaluate([item({status: '不适用', naReason: '   '})]);
  assert.equal(result.reviewState, 'blocked');
  assert.equal(result.na, 0);
  assert.equal(result.applicable, 1);
  assert.equal(result.open, 1);
  assert.match(result.reasons['check-1'].join('；'), /不适用理由/);
});

test('critical checks block in every category, including reconciliation and launch preparation', function () {
  for (const category of ['rule', 'test', 'data', 'issue', 'launch']) {
    const check = item({category, critical: true, status: '进行中'});
    assert.ok(Readiness.blockingReasons(check).length, category);
    assert.equal(Readiness.evaluate([check]).reviewState, 'blocked', category);
  }
});

test('a serious issue marked passed is still open until retest, history and impact are confirmed', function () {
  const incomplete = closedIssue({retest: '未复测', history: '待处理', impact: '待评估'});
  const result = Readiness.evaluate([incomplete]);
  assert.equal(result.reviewState, 'blocked');
  assert.equal(result.blockers.length, 1);
  assert.equal(result.severe, 1);
  assert.equal(result.pass, 0);
  assert.equal(result.open, 1);
  assert.equal(result.reasons['check-1'].length, 3);
  assert.equal(Readiness.evaluate([closedIssue()]).reviewState, 'review');
  assert.equal(Readiness.evaluate([closedIssue({history: '不涉及', impact: '是'})]).reviewState, 'review');
});

test('serious issues cannot close with missing or failed follow-up fields', function () {
  for (const patch of [{retest: '不通过'}, {history: ''}, {history: '待处理'}, {impact: ''}, {impact: '   '}, {impact: '待评估'}]) {
    assert.ok(Readiness.blockingReasons(closedIssue(patch)).length, JSON.stringify(patch));
  }
  assert.match(Readiness.blockingReasons(closedIssue({status: '进行中'})).join('；'), /尚未关闭/);
});

test('a justified exemption can waive a serious issue without inventing retest results', function () {
  const check = closedIssue({status: '不适用', naReason: '该模块不在本次变更范围，已由业务确认', retest: '未复测', history: '待处理', impact: ''});
  assert.deepEqual(Readiness.blockingReasons(check), []);
  const result = Readiness.evaluate([check, item({id: 'other', status: '通过'})]);
  assert.equal(result.na, 1);
  assert.equal(result.severe, 0);
  assert.equal(result.rate, 100);
});

test('critical business rules require a confirmer, actual basis and evidence', function () {
  assert.deepEqual(Readiness.blockingReasons(confirmedRule()), []);
  for (const patch of [{confirmOwner: ''}, {basis: ''}, {basis: '待填写本项目确认依据'}, {basis: ' 请填写口径依据 '}, {basis: 'TODO: 确认口径'}, {evidence: '  '}]) {
    assert.ok(Readiness.blockingReasons(confirmedRule(patch)).length, JSON.stringify(patch));
  }
});

test('core tests need actual results and evidence before passed status is effective', function () {
  const check = item({category: 'test', critical: true, status: '通过', actual: '源系统与目标系统的冲销明细一致', evidence: '复测记录.pdf'});
  assert.deepEqual(Readiness.blockingReasons(check), []);
  assert.match(Readiness.blockingReasons(Object.assign({}, check, {actual: ''})).join('；'), /实际结果/);
  assert.match(Readiness.blockingReasons(Object.assign({}, check, {evidence: ''})).join('；'), /验收证据/);
});

test('critical data and launch checks need evidence even after being marked passed', function () {
  for (const category of ['data', 'launch']) {
    const check = item({category, critical: true, status: '通过'});
    assert.match(Readiness.blockingReasons(check).join('；'), /验收证据/);
    check.evidence = '验收附件.pdf';
    assert.deepEqual(Readiness.blockingReasons(check), []);
  }
});

test('critical data cannot pass with remaining reconciliation anomalies or a single data source', function () {
  const check = item({category: 'data', critical: true, status: '通过', evidence: '对账记录.pdf'});
  for (const reconciliation of [{issues: 1, both: true}, {issues: 0, both: false}, {issues: 3, both: false}]) {
    assert.ok(Readiness.blockingReasons(Object.assign({}, check, {reconciliation})).length, JSON.stringify(reconciliation));
  }
  assert.deepEqual(Readiness.blockingReasons(Object.assign({}, check, {reconciliation: {issues: 0, both: true}})), []);
});

test('noncritical unfinished checks and demonstration data still require completion before review', function () {
  assert.equal(Readiness.evaluate([item({status: '进行中'})]).reviewState, 'pending');
  assert.equal(Readiness.evaluate([confirmedRule({example: true})]).reviewState, 'pending');
  const result = Readiness.evaluate([confirmedRule()]);
  assert.equal(result.reviewState, 'review');
  assert.match(result.reviewMessage, /人工上线评审/);
});

test('completion rate counts only effective passes and excludes justified exemptions', function () {
  const result = Readiness.evaluate([
    confirmedRule(),
    item({id: 'open', category: 'launch', critical: true, status: '通过'}),
    item({id: 'exempt', status: '不适用', naReason: '本次不涉及'})
  ]);
  assert.equal(result.total, 3);
  assert.equal(result.applicable, 2);
  assert.equal(result.pass, 1);
  assert.equal(result.na, 1);
  assert.equal(result.open, 1);
  assert.equal(result.rate, 50);
  assert.equal(result.blockers[0].id, 'open');
});

test('exports work in an offline browser without CommonJS or network dependencies', function () {
  const context = vm.createContext({});
  vm.runInContext(fs.readFileSync(require.resolve('../assets/readiness.js'), 'utf8'), context);
  assert.equal(typeof context.Readiness.blockingReasons, 'function');
  assert.equal(context.Readiness.evaluate([]).reviewState, 'insufficient');
});
