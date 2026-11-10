'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const STORE_KEY = 'launch-check-assistant-v1';

// Only the DOM surfaces used by app startup and reconciliation are simulated.
// Application functions, script ordering, storage and event handlers run unchanged.
class ElementStub {
  constructor(id, document) {
    this.id = id;
    this.document = document;
    this.value = '';
    this.textContent = '';
    this.checked = false;
    this.disabled = false;
    this.hidden = false;
    this.style = {};
    this.dataset = {};
    this.listeners = new Map();
    this._html = '';
    const classes = new Set();
    this.classList = {
      add: value => classes.add(value),
      remove: value => classes.delete(value),
      contains: value => classes.has(value)
    };
  }

  set innerHTML(html) {
    this._html = String(html);
    if (this.id === 'autoMap') this.document.readMapSelects(this._html);
    const options = [...this._html.matchAll(/<option\b([^>]*)>/g)];
    if (options.length) {
      const selected = options.find(option => /\bselected\b/.test(option[1])) || options[0];
      const value = /\bvalue="([^"]*)"/.exec(selected[1]);
      this.value = value ? value[1] : '';
    }
  }

  get innerHTML() { return this._html; }

  addEventListener(type, handler) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(handler);
    this.listeners.set(type, listeners);
  }

  emit(type, target = this) {
    for (const handler of this.listeners.get(type) || []) handler({target});
  }
}

class DocumentStub {
  constructor() {
    this.elements = new Map();
    this.mapSelects = [];
    this.body = {style: {}};
    this.listeners = new Map();
    this.contextInputs = ['project', 'version', 'cutoff', 'scope'].map(key => {
      const input = this.getElementById('context_' + key);
      input.dataset.context = key;
      return input;
    });
    this.autoWrite = this.getElementById('autoWriteButton');
    this.autoWrite.disabled = true;
    this.getElementById('autoHeader').checked = true;
    this.getElementById('autoPrecision').value = '2';
    this.getElementById('autoTarget').value = 'new';
  }

  getElementById(id) {
    if (!this.elements.has(id)) this.elements.set(id, new ElementStub(id, this));
    return this.elements.get(id);
  }

  addEventListener(type, handler) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(handler);
    this.listeners.set(type, listeners);
  }

  readMapSelects(html) {
    this.mapSelects = [...html.matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/g)].map(match => {
      const id = /\bid="([^"]*)"/.exec(match[1])[1];
      const select = this.getElementById(id);
      select.dataset.side = /\bdata-side="([^"]*)"/.exec(match[1])[1];
      select.dataset.k = /\bdata-k="([^"]*)"/.exec(match[1])[1];
      select.innerHTML = match[2];
      return select;
    });
  }

  querySelectorAll(selector) {
    if (selector === '[data-context]') return this.contextInputs;
    const map = /^#autoMap select\[data-side="(src|sys)"\]$/.exec(selector);
    if (map) return this.mapSelects.filter(select => select.dataset.side === map[1]);
    throw new Error('Unexpected DOM query in integration test: ' + selector);
  }

  querySelector(selector) {
    if (selector === '[data-act="autoWrite"]') return this.autoWrite;
    throw new Error('Unexpected DOM query in integration test: ' + selector);
  }
}

function boot(saved = {v: 2, items: []}, memory) {
  const storage = memory || new Map();
  if (!memory && saved !== null) storage.set(STORE_KEY, JSON.stringify(saved));
  const document = new DocumentStub();
  const timers = new Map();
  let timerId = 0;
  const sandbox = {
    document,
    localStorage: {
      getItem: key => storage.has(key) ? storage.get(key) : null,
      setItem: (key, value) => storage.set(key, String(value))
    },
    setTimeout: handler => { timers.set(++timerId, handler); return timerId; },
    clearTimeout: id => timers.delete(id),
    confirm: () => true,
    alert: message => { throw new Error('Unexpected alert: ' + message); }
  };
  sandbox.window = sandbox;
  const context = vm.createContext(sandbox);
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const scripts = [...html.matchAll(/<script\b[^>]*\bsrc="(assets\/[^"?]+\.js)"[^>]*>/g)].map(match => match[1]);
  assert.ok(scripts.includes('assets/app.js'), 'load the real application entry point');
  for (const script of scripts) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, script), 'utf8'), context, {filename: script});
  }
  const run = code => vm.runInContext(code, context);
  return {document, storage, run, snapshot: code => JSON.parse(JSON.stringify(run(code)))};
}

function setItems(app, items) {
  app.run('state.items = ' + JSON.stringify(items) + '.map(normalizeItem)');
}

function reconcile(app, src, sys = '', precision = 2) {
  app.document.getElementById('autoSrc').value = src;
  app.document.getElementById('autoSys').value = sys;
  app.document.getElementById('autoPrecision').value = String(precision);
  app.run('runAutoCheck()');
  assert.equal(app.document.getElementById('autoErr').textContent, '');
  assert.equal(app.run('autoResult !== null'), true, 'analysis should complete');
  assert.equal(app.document.autoWrite.disabled, false);
}

test('saved empty ledger stays empty after save and a fresh application startup', () => {
  const app = boot({v: 2, items: [], context: {project: 'DEMO-SHIP-EMPTY'}});
  assert.deepEqual(app.snapshot('state.items'), []);
  assert.equal(app.run('stats().reviewState'), 'insufficient');
  app.run('save()');
  const reloaded = boot(null, app.storage);
  assert.deepEqual(reloaded.snapshot('state.items'), []);
  assert.equal(reloaded.run('state.context.project'), 'DEMO-SHIP-EMPTY');
  assert.equal(reloaded.document.getElementById('exampleBanner').hidden, true);
  assert.match(reloaded.document.getElementById('verdict').innerHTML, /尚无可评审的有效检查项/);
});

test('v1 local records survive startup and saving with an empty default context', () => {
  const original = {id: 'legacy-check', category: 'data', title: '旧版本核对记录', status: '进行中',
    note: '保留原核查范围', owner: '测试角色', detailCount: '7', evidence: '已有核对记录.pdf', customField: '保留'};
  const app = boot({v: 1, items: [original]});
  const loaded = app.snapshot('state.items[0]');
  for (const [key, value] of Object.entries(original)) assert.equal(loaded[key], value, key);
  assert.deepEqual(app.snapshot('state.context'), {project: '', version: '', cutoff: '', scope: ''});
  app.run('save()');
  const saved = JSON.parse(app.storage.get(STORE_KEY));
  assert.equal(saved.v, 2);
  assert.equal(saved.items[0].id, original.id);
  assert.equal(saved.items[0].customField, original.customField);
  assert.deepEqual(saved.context, {project: '', version: '', cutoff: '', scope: ''});
});

test('context input saves immediately and appears in the report without blur or change', () => {
  const app = boot();
  const values = {project: 'DEMO-SHIP-INPUT', version: 'TEST-INPUT-v2',
    cutoff: '2026-11-10 15:00', scope: '  专业H / 测试工程范围  '};
  for (const input of app.document.contextInputs) {
    input.value = values[input.dataset.context];
    input.emit('input');
    const saved = JSON.parse(app.storage.get(STORE_KEY));
    assert.equal(saved.context[input.dataset.context], input.value.trim());
  }
  assert.equal(app.run('state.context.scope'), '专业H / 测试工程范围');
  const report = app.run('buildReport()');
  assert.match(report, /项目 \/ 工程：DEMO-SHIP-INPUT/);
  assert.match(report, /拟上线版本：TEST-INPUT-v2/);
  assert.match(report, /取数截止：2026-11-10 15:00/);
  assert.match(report, /核查范围：专业H \/ 测试工程范围/);
  const reloaded = boot(null, app.storage);
  assert.equal(reloaded.run('state.context.scope'), '专业H / 测试工程范围');
  assert.equal(reloaded.document.contextInputs.find(input => input.dataset.context === 'scope').value,
    '专业H / 测试工程范围');
});

test('adding a repair template twice appends once and preserves all existing work', () => {
  const app = boot();
  const old = {id: 'existing', category: 'data', title: '已有检查', status: '通过', critical: true,
    owner: '测试角色', note: '已有人工结论', evidence: '已有验收记录.pdf', project: 'DEMO-SHIP-OLD'};
  setItems(app, [old]);
  const before = app.snapshot('state.items[0]');
  app.document.getElementById('templateSelect').value = 'company-settlement';
  app.run('addTemplate(); addTemplate()');
  const items = app.snapshot('state.items');
  const count = app.run('window.SHIPREPAIR_TEMPLATES.find(t => t.id === "company-settlement").items.length');
  assert.equal(items.length, count + 1);
  assert.deepEqual(items[0], before);
  assert.equal(new Set(items.map(item => item.id)).size, items.length);
  assert.equal(new Set(items.slice(1).map(item => item.templateKey)).size, count);
  for (const item of items.slice(1)) {
    assert.equal(item.status, '待处理');
    assert.equal(item.owner, '');
    assert.equal(item.due, '');
    assert.equal(item.evidence, '');
    assert.equal(item.example, false);
  }
  assert.equal(JSON.parse(app.storage.get(STORE_KEY)).items.length, count + 1);
});

test('report includes restored context, escaped evidence and real blockers with effective category totals', () => {
  const app = boot({v: 2, items: [], context: {project: 'DEMO-<SHIP>', version: 'TEST-v2',
    cutoff: '2026-11-10 12:00', scope: '工程A & 专业H'}});
  setItems(app, [
    {id: 'confirmed', category: 'rule', title: '有效口径', critical: true, status: '通过',
      confirmOwner: '测试业务角色', basis: '本项目确认单第1条', evidence: '验收&记录.pdf'},
    {id: 'unconfirmed', category: 'rule', title: '缺少确认的口径', critical: true, status: '通过',
      basis: '待填写本项目确认依据', evidence: ''},
    {id: 'untested', category: 'test', title: '未记录实际结果', critical: true, status: '通过',
      expected: '来源与目标一致', actual: '', evidence: '测试附件.pdf'}
  ]);
  const report = app.run('buildReport()');
  assert.match(report, /项目 \/ 工程：DEMO-&lt;SHIP&gt;/);
  assert.match(report, /拟上线版本：TEST-v2/);
  assert.match(report, /取数截止：2026-11-10 12:00/);
  assert.match(report, /核查范围：工程A &amp; 专业H/);
  assert.match(report, /验收证据：验收&amp;记录\.pdf/);
  assert.match(report, /关键业务规则缺少业务确认人/);
  assert.match(report, /关键业务规则缺少有效确认依据/);
  assert.match(report, /核心测试缺少实际结果/);
  assert.match(report, /业务规则确认<span class="cnt">2 项 · 有效通过 1<\/span>/);
  assert.match(report, /关键测试<span class="cnt">1 项 · 有效通过 0<\/span>/);
  assert.match(report, /暂不具备上线条件/);
  assert.equal(app.run('stats().pass'), 1);
  assert.equal(app.run('stats().blockers.length'), 2);
});

test('source-only analysis writes source statistics, decimal rounding and unknown target counts honestly', () => {
  const app = boot();
  reconcile(app, '流程号\t金额\nF-1\t1.005\nF-2\t-0.005\nF-3\t0\nF-4\t\nF-5\t非法数值');
  assert.equal(app.run('autoResult.src.rows'), 5);
  assert.equal(app.run('autoResult.sys.rows'), 0);
  assert.equal(app.run('autoResult.src.empty'), 1);
  assert.equal(app.run('autoResult.src.invalid'), 1);
  assert.equal(app.run('autoResult.src.zero'), 1);
  app.run('writeAutoResult()');
  const item = app.snapshot('state.items[0]');
  assert.equal(item.detailCount, '5');
  assert.equal(item.summaryCount, '', 'no target table is unknown, not zero');
  assert.equal(item.posSum, '1.01');
  assert.equal(item.negSum, '-0.01');
  assert.equal(item.zeroCount, '1');
  assert.equal(item.status, '进行中');
  assert.equal(item.reconciliation.both, false);
  assert.equal(item.reconciliation.issues, 2);
  assert.match(item.note, /仅单份数据，未核对两边一致性/);
  assert.match(item.note, /未选列，未核查/);
  assert.equal(JSON.parse(app.storage.get(STORE_KEY)).items[0].posSum, '1.01');
});

test('target-only analysis does not invent a source count or overwrite statistics with empty-side zero', () => {
  const app = boot();
  reconcile(app, '', '流程号\t金额\nF-1\t6.5\nF-2\t-1.25');
  app.run('writeAutoResult()');
  const item = app.snapshot('state.items[0]');
  assert.equal(item.detailCount, '');
  assert.equal(item.summaryCount, '2');
  assert.equal(item.posSum, '6.5');
  assert.equal(item.negSum, '-1.25');
  assert.equal(item.reconciliation.both, false);
});

test('typing new data invalidates previous analysis before delayed map refresh or write', () => {
  const app = boot();
  reconcile(app, '流程号\t金额\nF-1\t2');
  const input = app.document.getElementById('autoSrc');
  input.value = '流程号\t金额\nF-1\t99';
  input.emit('input');
  assert.equal(app.run('autoResult'), null);
  assert.equal(app.document.autoWrite.disabled, true);
  app.run('writeAutoResult()');
  assert.equal(app.run('state.items.length'), 0);
  assert.match(app.document.getElementById('autoErr').textContent, /重新核对/);
});

test('changing a mapping invalidates analysis and cannot write a stale result', () => {
  const app = boot();
  reconcile(app, '流程号\t金额\t工程编号\nF-1\t2\tDEMO-SHIP-001');
  const mapping = app.document.getElementById('map_src_project');
  mapping.value = '-1';
  app.document.getElementById('autoMap').emit('change', mapping);
  assert.equal(app.run('autoResult'), null);
  assert.equal(app.document.autoWrite.disabled, true);
  app.run('writeAutoResult()');
  assert.equal(app.run('state.items.length'), 0);
  assert.match(app.document.getElementById('autoErr').textContent, /重新核对/);
});

test('write fingerprints reject changed values even without an input event', () => {
  const app = boot();
  reconcile(app, '流程号\t金额\nF-1\t2');
  app.document.getElementById('autoSrc').value = '流程号\t金额\nF-1\t3';
  app.run('writeAutoResult()');
  assert.equal(app.run('state.items.length'), 0);
  assert.equal(app.run('autoResult'), null);
  assert.match(app.document.getElementById('autoErr').textContent, /数据或列对应已变化/);
});

test('writing new analysis to an existing passed item reopens it and preserves manual untested scope', () => {
  const app = boot();
  setItems(app, [{id: 'existing-data', category: 'data', title: '已验收的核对记录', status: '通过', critical: true,
    note: '原人工备注：仅核对特定工程', evidence: '原验收证据.pdf', owner: '测试角色',
    project: 'DEMO-SHIP-OLD', dept: '原专业', period: '原期间', team: '原施工队'}]);
  reconcile(app, '流程号\t金额\nF-1\t7', '流程号\t金额\nF-1\t7');
  app.document.getElementById('autoTarget').value = 'existing-data';
  app.run('writeAutoResult()');
  const item = app.snapshot('state.items[0]');
  assert.equal(app.run('state.items.length'), 1);
  assert.equal(item.id, 'existing-data');
  assert.equal(item.status, '进行中');
  assert.equal(item.detailCount, '1');
  assert.equal(item.summaryCount, '1');
  assert.match(item.note, /^原人工备注：仅核对特定工程\n\n自动核对 /);
  assert.match(item.note, /未选列，未核查/);
  assert.equal(item.project, 'DEMO-SHIP-OLD');
  assert.equal(item.dept, '原专业');
  assert.equal(item.period, '原期间');
  assert.equal(item.team, '原施工队');
  assert.equal(item.evidence, '原验收证据.pdf');
  assert.equal(item.owner, '测试角色');
  assert.equal(item.reconciliation.both, true);
  assert.equal(item.reconciliation.issues, 0);
  assert.deepEqual(item.reconciliation.ranges, {src: {}, sys: {}});
});

test('written reconciliation retains every selected scope value and flags blank selected dimensions', () => {
  const app = boot();
  const source = '流程号\t金额\t工程编号\t专业\t期间\t施工队\t明细行号\n' +
    'F-1\t2\tDEMO-SHIP-001\tH\t2026-10\tTEST-TEAM-A\t1\n' +
    'F-2\t3\tDEMO-SHIP-002\tE\t2026-11\tTEST-TEAM-B\t2\n' +
    'F-3\t4\tDEMO-SHIP-002\t\t2026-11\tTEST-TEAM-B\t3';
  reconcile(app, source, source);
  assert.equal(app.run('autoResult.src.missingDimensions'), 1);
  assert.equal(app.run('autoResult.sys.missingDimensions'), 1);
  assert.ok(app.run('autoResult.issues') >= 2, 'missing selected dimensions must count as unresolved quality issues');
  app.run('writeAutoResult()');
  const item = app.snapshot('state.items[0]');
  assert.equal(item.project, '多个（见核对备注）');
  for (const side of ['src', 'sys']) {
    assert.deepEqual(item.reconciliation.ranges[side].project, ['DEMO-SHIP-001', 'DEMO-SHIP-002']);
    assert.deepEqual(item.reconciliation.ranges[side].dept, ['H', 'E', '']);
    assert.deepEqual(item.reconciliation.ranges[side].period, ['2026-10', '2026-11']);
    assert.deepEqual(item.reconciliation.ranges[side].team, ['TEST-TEAM-A', 'TEST-TEAM-B']);
    assert.deepEqual(item.reconciliation.ranges[side].line, ['1', '2', '3']);
  }
  for (const value of ['DEMO-SHIP-001', 'DEMO-SHIP-002', 'TEST-TEAM-A', 'TEST-TEAM-B', '2026-10', '2026-11']) {
    assert.ok(item.note.includes(value), 'scope must remain available in exported notes: ' + value);
  }
  assert.match(item.note, /（空）/);
  const report = app.run('buildReport()');
  assert.match(report, /DEMO-SHIP-001/);
  assert.match(report, /DEMO-SHIP-002/);
});
