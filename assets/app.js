'use strict';

/* ================= 基础配置 ================= */
const STORE_KEY = 'launch-check-assistant-v1';
const STATUSES = ['待处理', '进行中', '通过', '不通过', '不适用'];
const PRIORITIES = ['高', '中', '低'];
const ST_CLASS = {'待处理': 's-todo', '进行中': 's-doing', '通过': 's-pass', '不通过': 's-fail', '不适用': 's-na'};

const CATS = [
  {id: 'rule',   name: '业务规则确认', hint: '先把口径写成文字，再让业务签字确认'},
  {id: 'test',   name: '关键测试',     hint: '正数、负数、0、空值、边界与重试都要跑一遍'},
  {id: 'data',   name: '数据核对',     hint: '漏抓、多抓、重复、字段错误，明细对汇总'},
  {id: 'issue',  name: '问题闭环',     hint: '严重缺陷必须关闭并复测通过'},
  {id: 'launch', name: '上线准备',     hint: '版本、配置、确认人、备份回滚、上线后检查'}
];
const CAT_NAME = {};
CATS.forEach(c => CAT_NAME[c.id] = c.name);

const EXTRA_FIELDS = {
  rule: [
    {k: 'confirmOwner', l: '业务确认人', t: 'text', ph: '如：李强（生产部）'},
    {k: 'basis', l: '确认依据', t: 'textarea', ph: '口径确认单编号 / 会议纪要 / 签字文档链接'}
  ],
  test: [
    {k: 'steps', l: '测试步骤', t: 'textarea', ph: '1. 造一条退货单（数量 -10）\n2. 执行采集\n3. 查看汇总结果'},
    {k: 'expected', l: '预期结果', t: 'textarea', ph: '应记为 -10，汇总负数合计减少 10'},
    {k: 'actual', l: '实际结果', t: 'textarea', ph: '实际记为 0，负数合计未变化'}
  ],
  data: [
    {k: 'project', l: '船次 / 工程编号', t: 'text', ph: '如：DEMO-SHIP-001'},
    {k: 'dept', l: '专业 / 部门', t: 'text', ph: '如：轮机'},
    {k: 'team', l: '施工队 / 车间', t: 'text', ph: '填写本次核查范围'},
    {k: 'period', l: '期间', t: 'text', ph: '如：2026-10'},
    {k: 'detailCount', l: '源明细条数', t: 'number', ph: '12480'},
    {k: 'summaryCount', l: '目标明细 / 汇总条数', t: 'number', ph: '12480'},
    {k: 'posSum', l: '正数合计', t: 'number', ph: '85320.5'},
    {k: 'negSum', l: '负数合计', t: 'number', ph: '-1240.0'},
    {k: 'zeroCount', l: '零值行数', t: 'number', ph: '0'}
  ],
  issue: [
    {k: 'repro', l: '复现步骤', t: 'textarea', ph: '用哪张单据、什么时间、执行了什么操作'},
    {k: 'diff', l: '预期与实际差异', t: 'textarea', ph: '预期 -10，实际 0，影响 10 月产量报表'},
    {k: 'severity', l: '严重程度', t: 'select', opts: ['严重', '一般', '轻微']},
    {k: 'devOwner', l: '开发负责人', t: 'text', ph: '如：王磊'},
    {k: 'fixVersion', l: '修复版本', t: 'text', ph: '如：V2.3.1'},
    {k: 'retest', l: '复测结果', t: 'select', opts: ['未复测', '通过', '不通过']},
    {k: 'impact', l: '相关功能是否受影响', t: 'select', opts: ['是', '否', '待评估']},
    {k: 'history', l: '历史错数是否处理', t: 'select', opts: ['不涉及', '待处理', '已处理']}
  ],
  launch: [
    {k: 'version', l: '版本号', t: 'text', ph: '如：V2.3.1'},
    {k: 'bizOwner', l: '业务负责人', t: 'text', ph: '如：李强'},
    {k: 'rollback', l: '备份与回滚方案', t: 'textarea', ph: '备份时间点、回滚步骤、责任人'},
    {k: 'postCheck', l: '上线后关键检查项', t: 'textarea', ph: '上线 24 小时内的对账与巡检内容'}
  ]
};

/* ================= 工具函数 ================= */
function uid() {
  return 'i' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, m => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[m]));
}
function pad2(n) { return n < 10 ? '0' + n : '' + n; }
function stamp() {
  const d = new Date();
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + '_' + pad2(d.getHours()) + pad2(d.getMinutes());
}
function nowText() {
  const d = new Date();
  return pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds());
}
function download(name, content, type) {
  const blob = new Blob([content], {type: type || 'text/plain;charset=utf-8'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1200);
}
function toast(msg, action) {
  const el = document.getElementById('toast');
  const btn = document.getElementById('toastUndo');
  document.getElementById('toastMsg').textContent = msg;
  clearTimeout(toast._t);
  if (action) {
    btn.hidden = false;
    btn.textContent = action.label || '撤销';
    btn.onclick = () => {
      hideToast();
      action.fn();
    };
  } else {
    btn.hidden = true;
    btn.onclick = null;
  }
  el.classList.add('show');
  toast._t = setTimeout(hideToast, action ? 6000 : 1800);
}
function hideToast() {
  document.getElementById('toast').classList.remove('show');
  const btn = document.getElementById('toastUndo');
  btn.hidden = true;
  btn.onclick = null;
  clearTimeout(toast._t);
}
function num(v) {
  return v === '' || v == null || isNaN(Number(v)) ? null : Number(v);
}
function parseDue(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}
function daysToDue(it) {
  const d = parseDue(it.due);
  if (!d) return null;
  const t = new Date();
  const today = new Date(t.getFullYear(), t.getMonth(), t.getDate());
  return Math.round((d - today) / 86400000);
}
function dueInfo(it) {
  if (!it.due || it.status === '通过' || it.status === '不适用') return null;
  const n = daysToDue(it);
  if (n === null) return null;
  if (n < 0) return {overdue: true, text: '逾期 ' + (-n) + ' 天'};
  if (n <= 3) return {overdue: false, text: n === 0 ? '今天到期' : n + ' 天后到期'};
  return null;
}
function hl(s) {
  const raw = String(s == null ? '' : s);
  const q = state.filter.q.trim();
  if (!q) return esc(raw);
  const lower = raw.toLowerCase();
  const ql = q.toLowerCase();
  let out = '', i = 0, idx;
  while ((idx = lower.indexOf(ql, i)) !== -1) {
    out += esc(raw.slice(i, idx)) + '<mark class="mark">' + esc(raw.slice(idx, idx + q.length)) + '</mark>';
    i = idx + q.length;
  }
  return out + esc(raw.slice(i));
}

/* ================= 数据模型 ================= */
function mk(cat, title, o) {
  return Object.assign({
    id: uid(), category: cat, title: title,
    owner: '', priority: '中', due: '', status: '待处理',
    critical: false, note: '', evidence: '', naReason: '',
    example: false, updatedAt: Date.now()
  }, o || {});
}

function seedItems() {
  // Only fictional check prompts; never pre-confirm a project rule or test result.
  return window.SHIPREPAIR_TEMPLATES[0].items.map(spec => mk(spec.category, spec.title,
    Object.assign({}, spec, {example: true, note: '演示模板：' + spec.note})));
}
/* ================= 状态与存储 ================= */
const state = {
  items: [],
  context: {project: '', version: '', cutoff: '', scope: ''},
  filter: {cat: 'all', owner: 'all', status: 'all', sort: 'default', q: '', onlyOpen: false, onlyOverdue: false}
};
let editingId = null;

function save() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({v: 2, updatedAt: Date.now(), items: state.items, context: state.context}));
    document.getElementById('savedTip').textContent = '已自动保存 ' + nowText();
  } catch (e) {
    toast('保存失败：浏览器本地存储不可用');
  }
}
function load() {
  try {
    const data = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
    if (data && Array.isArray(data.items)) {
      restoreContext(data.context);
      return data.items;
    }
  } catch (e) { /* 数据损坏时退回示例 */ }
  return null;
}

/* ================= 判定逻辑 ================= */
function isBlocking(it) {
  return Readiness.blockingReasons(it).length > 0;
}

function stats() {
  const result = Readiness.evaluate(state.items);
  result.overdue = state.items.filter(i => { const d = dueInfo(i); return d && d.overdue; }).length;
  return result;
}

function restoreContext(data) {
  Object.keys(state.context).forEach(k => { state.context[k] = data && typeof data[k] === 'string' ? data[k] : ''; });
}
function renderContext() {
  document.querySelectorAll('[data-context]').forEach(el => { el.value = state.context[el.dataset.context] || ''; });
}
function contextText() {
  return ['项目 / 工程：' + (state.context.project || '未填写'), '拟上线版本：' + (state.context.version || '未填写'),
    '取数截止：' + (state.context.cutoff || '未填写'), '核查范围：' + (state.context.scope || '未填写')].join('；');
}
function addTemplate() {
  const t = window.SHIPREPAIR_TEMPLATES.find(t => t.id === document.getElementById('templateSelect').value);
  if (!t) return;
  const keys = new Set(state.items.map(i => i.templateKey).filter(Boolean));
  const added = t.items.filter(i => !keys.has(i.templateKey)).map(i => mk(i.category, i.title, i));
  state.items.push(...added);
  save(); renderAll();
  toast(added.length ? '已添加 ' + added.length + ' 项待核对内容：' + t.name : '该模板检查项已存在');
}
function verdictInfo(s) {
  if (s.reviewState === 'blocked') return {kind: 'bad', title: '暂不具备上线条件', text: '共 ' + s.blockers.length + ' 项阻断，补齐处理与验收证据后再评审。'};
  if (s.reviewState === 'insufficient') return {kind: 'warn', title: '尚无可评审的有效检查项', text: '添加本次适用的检查项并完成核实，空台账或全部不适用不能作为上线依据。'};
  if (s.reviewState === 'pending') return {kind: 'warn', title: '仍有待核实内容', text: '还有未完成项或演示数据，请完成检查后提交业务负责人评审。'};
  if (Object.values(state.context).some(v => !v.trim())) return {kind: 'warn', title: '请补齐本次上线范围', text: '补充项目、版本、取数时点和核查范围，保证验收记录可追溯。'};
  return {kind: 'ok', title: '检查已记录，待人工上线评审', text: '台账未发现阻断项；最终上线决定须由业务负责人确认。'};
}

/* ================= 文案生成 ================= */
function detailText(it) {
  const parts = [];
  if (it.category === 'rule') {
    if (it.confirmOwner) parts.push('确认人：' + it.confirmOwner);
    if (it.basis) parts.push('依据：' + it.basis);
  } else if (it.category === 'test') {
    if (it.expected) parts.push('预期：' + it.expected);
    if (it.actual) parts.push('实际：' + it.actual);
    if (!it.expected && it.steps) parts.push('步骤：' + it.steps);
  } else if (it.category === 'data') {
    const scope = [it.project, it.dept, it.team, it.period].filter(Boolean).join(' / ');
    if (scope) parts.push(scope);
    const d = num(it.detailCount), s = num(it.summaryCount);
    if (d !== null && s !== null) parts.push('源明细 ' + d + ' / 目标 ' + s + ' 条（差 ' + (d - s) + '）');
    else if (d !== null) parts.push('明细 ' + d + ' 条');
    if (it.posSum !== '' && it.posSum != null) parts.push('正数合计 ' + it.posSum);
    if (it.negSum !== '' && it.negSum != null) parts.push('负数合计 ' + it.negSum);
    if (it.zeroCount !== '' && it.zeroCount != null) parts.push('零值 ' + it.zeroCount + ' 行');
  } else if (it.category === 'issue') {
    if (it.severity) parts.push('严重程度：' + it.severity);
    if (it.devOwner) parts.push('开发：' + it.devOwner);
    if (it.fixVersion) parts.push('修复版本：' + it.fixVersion);
    if (it.retest) parts.push('复测：' + it.retest);
    if (it.impact) parts.push('影响其他功能：' + it.impact);
    if (it.history) parts.push('历史错数：' + it.history);
  } else if (it.category === 'launch') {
    if (it.version) parts.push('版本：' + it.version);
    if (it.bizOwner) parts.push('业务负责人：' + it.bizOwner);
    if (it.rollback) parts.push('回滚：' + it.rollback);
    if (it.postCheck) parts.push('上线后检查：' + it.postCheck);
  }
  return parts.join(' · ');
}

/* ================= 渲染：结论 ================= */
function renderVerdict() {
  const s = stats();
  const info = verdictInfo(s);
  const el = document.getElementById('verdict');
  el.className = 'verdict ' + info.kind;
  el.innerHTML = '<div class="v-icon">' + (info.kind === 'ok' ? '&#10003;' : '!') + '</div><div class="v-body">' +
    '<div class="v-title">' + esc(info.title) + '</div><div class="v-sub">' + esc(info.text) + '</div>' +
    '<ul class="v-list">' + s.blockers.map(i => '<li>' + esc(CAT_NAME[i.category]) + '｜' + esc(i.title) + '：' +
      esc(Readiness.blockingReasons(i).join('；')) + '</li>').join('') + '</ul></div>';
}

/* ================= 渲染：统计 ================= */
function renderStats() {
  const s = stats();
  document.getElementById('stats').innerHTML =
    '<div class="stat">' +
      '<div class="label">完成进度</div>' +
      '<div class="num">' + s.rate + '<small>%</small></div>' +
      '<div class="bar"><i style="width:' + s.rate + '%"></i></div>' +
      '<div class="cap">通过 ' + s.pass + ' / 应完成 ' + (s.total - s.na) + ' 项</div>' +
    '</div>' +
    '<div class="stat">' +
      '<div class="label">未完成项</div>' +
      '<div class="num">' + s.open + '<small>项</small></div>' +
      '<div class="cap' + (s.overdue ? ' overdue' : '') + '">' + (s.overdue ? '其中逾期 ' + s.overdue + ' 项，建议优先跟进' : '含待处理、进行中、不通过') + '</div>' +
    '</div>' +
    '<div class="stat' + (s.severe ? ' alert' : '') + '">' +
      '<div class="label">严重问题</div>' +
      '<div class="num">' + s.severe + '<small>项</small></div>' +
      '<div class="cap">严重缺陷未关闭即阻断上线</div>' +
    '</div>' +
    '<div class="stat' + (s.blockers.length ? ' alert' : '') + '">' +
      '<div class="label">阻断项</div>' +
      '<div class="num">' + s.blockers.length + '<small>项</small></div>' +
      '<div class="cap">不适用 ' + s.na + ' 项 / 共 ' + s.total + ' 项</div>' +
    '</div>';
}

/* ================= 渲染：筛选 ================= */
function renderFilters() {
  const fCat = document.getElementById('fCat');
  fCat.innerHTML = '<option value="all">全部类别</option>' +
    CATS.map(c => '<option value="' + c.id + '">' + c.name + '</option>').join('');
  fCat.value = state.filter.cat;

  const fStatus = document.getElementById('fStatus');
  fStatus.innerHTML = '<option value="all">全部状态</option>' +
    STATUSES.map(s => '<option value="' + s + '">' + s + '</option>').join('');
  fStatus.value = state.filter.status;

  const owners = Array.from(new Set(state.items.map(i => i.owner || '未指派'))).sort();
  const fOwner = document.getElementById('fOwner');
  fOwner.innerHTML = '<option value="all">全部负责人</option>' +
    owners.map(o => '<option value="' + esc(o) + '">' + esc(o) + '</option>').join('');
  if (!owners.includes(state.filter.owner)) state.filter.owner = 'all';
  fOwner.value = state.filter.owner;

  const fSort = document.getElementById('fSort');
  if (fSort) fSort.value = state.filter.sort;
  const fDue = document.getElementById('fDue');
  if (fDue) fDue.checked = state.filter.onlyOverdue;
}

/* ================= 渲染：列表 ================= */
function statusOptions(cur) {
  return STATUSES.map(s => '<option value="' + s + '"' + (s === cur ? ' selected' : '') + '>' + s + '</option>').join('');
}

function itemHtml(it) {
  const st = ST_CLASS[it.status] || 's-todo';
  const due = dueInfo(it);
  const ev = it.evidence
    ? (/^https?:\/\//i.test(it.evidence)
        ? '<span>证据：<a href="' + esc(it.evidence) + '" target="_blank" rel="noopener">打开链接</a></span>'
        : '<span>证据：' + hl(it.evidence) + '</span>')
    : '';
  const reasons = Readiness.blockingReasons(it);
  return '<div class="item" data-id="' + esc(it.id) + '">' +
    '<div class="item-main" data-act="edit">' +
      '<div class="item-title-row">' +
        '<span class="item-title' + (it.status === '通过' && !reasons.length ? ' done' : '') + '">' + hl(it.title || '（未命名检查项）') + '</span>' +
        (it.critical ? '<span class="badge b-key">关键</span>' : '') +
        (it.priority ? '<span class="badge p-' + esc(it.priority) + '">' + esc(it.priority) + '优先级</span>' : '') +
        (due ? '<span class="badge ' + (due.overdue ? 'b-overdue' : 'b-soon') + '">' + due.text + '</span>' : '') +
        (it.example ? '<span class="badge b-ex">示例</span>' : '') +
      '</div>' +
      '<div class="item-meta">' +
        '<span>负责人：' + esc(it.owner || '未指派') + '</span>' +
        '<span class="due' + (due ? (due.overdue ? ' late' : ' soon') : '') + '">截止：' + (it.due ? esc(it.due) : '—') + '</span>' +
        ev +
      '</div>' +
      (detailText(it) ? '<div class="item-detail">' + hl(detailText(it)) + '</div>' : '') +
      (it.status === '不适用' && it.naReason ? '<div class="item-na">不适用理由：' + hl(it.naReason) + '</div>' : '') +
      (it.note ? '<div class="item-note">备注：' + hl(it.note) + '</div>' : '') +
      (reasons.length ? '<div class="item-block">阻断原因：' + esc(reasons.join('；')) + '</div>' : '') +
    '</div>' +
    '<div class="item-side">' +
      '<select class="st ' + st + '" data-act="status">' + statusOptions(it.status) + '</select>' +
      '<div class="side-btns">' +
        (it.status !== '通过' && it.status !== '不适用' ? '<button class="mini pass" data-act="quickPass" title="标记为通过">通过</button>' : '') +
        '<button class="mini" data-act="edit">编辑</button>' +
        '<button class="mini danger" data-act="del">删除</button>' +
      '</div>' +
    '</div>' +
  '</div>';
}

const P_ORDER = {'高': 0, '中': 1, '低': 2};
function cmpDue(a, b) {
  const x = daysToDue(a), y = daysToDue(b);
  if (x === null && y === null) return 0;
  if (x === null) return 1;
  if (y === null) return -1;
  return x - y;
}
function sortItems(list) {
  const arr = list.slice();
  const mode = state.filter.sort;
  if (mode === 'priority') {
    arr.sort((a, b) => {
      const pa = P_ORDER[a.priority] == null ? 1 : P_ORDER[a.priority];
      const pb = P_ORDER[b.priority] == null ? 1 : P_ORDER[b.priority];
      return pa - pb || cmpDue(a, b);
    });
  } else if (mode === 'due') {
    arr.sort(cmpDue);
  } else if (mode === 'updated') {
    arr.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  }
  return arr;
}

function filteredItems() {
  const f = state.filter;
  const q = f.q.trim().toLowerCase();
  return state.items.filter(it => {
    if (f.cat !== 'all' && it.category !== f.cat) return false;
    if (f.owner !== 'all' && (it.owner || '未指派') !== f.owner) return false;
    if (f.status !== 'all' && it.status !== f.status) return false;
    if (f.onlyOpen && !isBlocking(it) && (it.status === '通过' || it.status === '不适用')) return false;
    if (f.onlyOverdue) { const d = dueInfo(it); if (!d || !d.overdue) return false; }
    if (q) {
      const blob = [it.title, it.note, it.basis, it.owner, it.evidence, it.devOwner, detailText(it)].join(' ').toLowerCase();
      if (blob.indexOf(q) === -1) return false;
    }
    return true;
  });
}

function renderList() {
  const shown = filteredItems();
  const listEl = document.getElementById('list');
  document.getElementById('filterCount').textContent = '共 ' + state.items.length + ' 项，筛选后 ' + shown.length + ' 项';

  if (!shown.length) {
    listEl.innerHTML = '<div class="empty">当前筛选条件下没有检查项。可以重置筛选，或新增一条检查项。</div>';
    return;
  }
  listEl.innerHTML = CATS.map(c => {
    if (state.filter.cat !== 'all' && state.filter.cat !== c.id) return '';
    const all = state.items.filter(i => i.category === c.id);
    const rows = sortItems(shown.filter(i => i.category === c.id));
    if (!rows.length) return '';
    const catStats = Readiness.evaluate(all);
    const pass = catStats.pass, rate = catStats.rate;
    return '<section class="cat">' +
      '<div class="cat-head">' +
        '<div>' +
          '<div class="cat-title">' + c.name + '<span class="cat-count">' + all.length + ' 项 · 通过 ' + pass + '</span></div>' +
          '<div class="cat-hint">' + c.hint + '</div>' +
        '</div>' +
        '<div class="cat-right">' +
          '<div class="mini-bar"><i style="width:' + rate + '%"></i></div>' +
          '<button class="mini" data-act="add" data-cat="' + c.id + '">+ 新增</button>' +
        '</div>' +
      '</div>' +
      rows.map(itemHtml).join('') +
    '</section>';
  }).join('');
}

function renderExampleBanner() {
  const n = state.items.filter(i => i.example).length;
  document.getElementById('exampleBanner').hidden = n === 0;
  document.getElementById('exampleCount').textContent = n;
}

function renderAll() {
  renderVerdict();
  renderStats();
  renderFilters();
  renderList();
  renderExampleBanner();
}
/* ================= 表单弹窗 ================= */
function extraField(f, v) {
  const id = 'f_' + f.k;
  let ctrl;
  if (f.t === 'textarea') {
    ctrl = '<textarea name="' + id + '" placeholder="' + esc(String(f.ph || '').replace(/\n/g, ' ')) + '">' + esc(v) + '</textarea>';
  } else if (f.t === 'select') {
    ctrl = '<select name="' + id + '">' + f.opts.map(o => '<option' + (o === v ? ' selected' : '') + '>' + o + '</option>').join('') + '</select>';
  } else {
    ctrl = '<input type="' + f.t + '" name="' + id + '" value="' + esc(v) + '" placeholder="' + esc(f.ph || '') + '">';
  }
  return '<div class="field"><label>' + f.l + '</label>' + ctrl + '</div>';
}

function renderForm(draft) {
  const cat = draft.category || 'rule';
  let html = '';
  html += '<div class="section-label">基础信息</div>';
  html += '<div class="field"><label>检查项名称 <em>*</em></label><input type="text" name="f_title" value="' + esc(draft.title) + '" placeholder="如：0 与空值处理"></div>';
  html += '<div class="field"><label>所属类别</label><select name="f_category" id="f_category">' +
    CATS.map(c => '<option value="' + c.id + '"' + (c.id === cat ? ' selected' : '') + '>' + c.name + '</option>').join('') + '</select></div>';
  html += '<div class="grid3">' +
    '<div class="field"><label>负责人</label><input type="text" name="f_owner" value="' + esc(draft.owner) + '" placeholder="如：张伟"></div>' +
    '<div class="field"><label>优先级</label><select name="f_priority">' +
      PRIORITIES.map(p => '<option' + (p === draft.priority ? ' selected' : '') + '>' + p + '</option>').join('') + '</select></div>' +
    '<div class="field"><label>截止日期</label><input type="date" name="f_due" value="' + esc(draft.due) + '"></div>' +
  '</div>';
  html += '<div class="grid2">' +
    '<div class="field"><label>状态</label><select name="f_status" id="f_status">' +
      STATUSES.map(s => '<option' + (s === draft.status ? ' selected' : '') + '>' + s + '</option>').join('') + '</select></div>' +
    '<div class="field"><label>是否关键项</label><label class="chk" style="margin-top:9px"><input type="checkbox" name="f_critical"' + (draft.critical ? ' checked' : '') + '> 任意类别关键项，未通过或缺少验收证据将阻断上线</label></div>' +
  '</div>';
  html += '<div class="field"><label>不适用理由（状态选“不适用”时必填）</label><input type="text" name="f_naReason" value="' + esc(draft.naReason) + '" placeholder="说明为什么不适用"></div>';

  html += '<div class="section-label">分类专项信息</div>';
  CATS.forEach(c => {
    const fields = EXTRA_FIELDS[c.id] || [];
    if (!fields.length) return;
    const inner = fields.map(f => extraField(f, draft[f.k] == null ? '' : draft[f.k])).join('');
    html += '<div class="extra" data-cat="' + c.id + '"' + (c.id === cat ? '' : ' hidden') + '>' +
      (c.id === 'data' ? '<div class="grid2">' + inner + '</div>' : inner) + '</div>';
  });

  html += '<div class="section-label">补充说明</div>';
  html += '<div class="field"><label>备注</label><textarea name="f_note" placeholder="补充说明、风险提示、规避方案">' + esc(draft.note) + '</textarea></div>';
  html += '<div class="field"><label>证据附件或链接</label><input type="text" name="f_evidence" value="' + esc(draft.evidence) + '" placeholder="文件路径、附件名或 https:// 链接"><div class="hint">本地文件无法自动上传，可填写共享盘路径或文档链接。</div></div>';

  document.getElementById('modalBody').innerHTML = html;
}

function toggleCatFields(cat) {
  document.querySelectorAll('#modalBody .extra').forEach(g => {
    g.hidden = g.dataset.cat !== cat;
  });
}

function openModal(id, presetCat) {
  editingId = id || null;
  const it = id ? state.items.find(i => i.id === id) : null;
  const cat = presetCat || (state.filter.cat !== 'all' ? state.filter.cat : 'rule');
  const draft = it || mk(cat, '', {status: '待处理'});
  renderForm(draft);
  document.getElementById('modalTitle').textContent = it ? '编辑检查项' : '新增检查项';
  document.getElementById('formErr').textContent = '';
  document.getElementById('overlay').hidden = false;
  document.body.style.overflow = 'hidden';
  setTimeout(() => {
    const t = document.querySelector('#modalBody [name="f_title"]');
    if (t) t.focus();
  }, 40);
}

function closeModal() {
  document.getElementById('overlay').hidden = true;
  document.body.style.overflow = '';
  editingId = null;
}

function readForm() {
  const o = {};
  document.querySelectorAll('#modalBody [name^="f_"]').forEach(el => {
    const k = el.name.slice(2);
    o[k] = el.type === 'checkbox' ? el.checked : el.value.trim();
  });
  return o;
}

function submitForm() {
  const v = readForm();
  const err = document.getElementById('formErr');
  if (!v.title) { err.textContent = '请填写检查项名称'; return; }
  if (v.status === '不适用' && !v.naReason) { err.textContent = '状态为“不适用”时必须填写不适用理由'; return; }

  const patch = {
    category: v.category, title: v.title, owner: v.owner, priority: v.priority, due: v.due,
    status: v.status, critical: !!v.critical, note: v.note, evidence: v.evidence, naReason: v.naReason,
    confirmOwner: v.confirmOwner, basis: v.basis,
    steps: v.steps, expected: v.expected, actual: v.actual,
    project: v.project, dept: v.dept, team: v.team, period: v.period,
    detailCount: v.detailCount, summaryCount: v.summaryCount,
    posSum: v.posSum, negSum: v.negSum, zeroCount: v.zeroCount,
    repro: v.repro, diff: v.diff, severity: v.severity, devOwner: v.devOwner, fixVersion: v.fixVersion,
    retest: v.retest, impact: v.impact, history: v.history,
    version: v.version, bizOwner: v.bizOwner, rollback: v.rollback, postCheck: v.postCheck,
    updatedAt: Date.now()
  };
  const current = editingId ? state.items.find(i => i.id === editingId) : {};
  if (patch.status === '通过') {
    const reasons = Readiness.blockingReasons(Object.assign({}, current, patch));
    if (reasons.length) { err.textContent = reasons.join('；'); return; }
  }

  if (editingId) {
    const it = state.items.find(i => i.id === editingId);
    if (it) Object.assign(it, patch);
  } else {
    const item = mk(v.category, v.title, {});
    Object.assign(item, patch);
    state.items.push(item);
  }
  save();
  closeModal();
  renderAll();
  toast('已保存');
}

/* ================= 备份 / 导入 / 报告 ================= */
function backupJson() {
  download('上线检查备份_' + stamp() + '.json',
    JSON.stringify({app: 'launch-check-assistant', version: 2, exportedAt: new Date().toISOString(), items: state.items, context: state.context}, null, 2),
    'application/json');
  toast('备份文件已导出');
}

function normalizeItem(x) {
  const it = Object.assign({
    id: uid(), category: 'rule', title: '', owner: '', priority: '中', due: '', status: '待处理',
    critical: false, note: '', evidence: '', naReason: '', example: false
  }, x);
  if (!it.id) it.id = uid();
  if (!CAT_NAME[it.category]) it.category = 'rule';
  if (STATUSES.indexOf(it.status) === -1) it.status = '待处理';
  if (PRIORITIES.indexOf(it.priority) === -1) it.priority = '中';
  return it;
}

const RPT_ST = {'待处理': 'r-todo', '进行中': 'r-doing', '通过': 'r-pass', '不通过': 'r-fail', '不适用': 'r-na'};

function buildReport() {
  const s = stats();
  const d = new Date();
  const dateStr = d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  const hasExample = state.items.some(i => i.example);

  const cats = CATS.map(c => {
    const list = state.items.filter(i => i.category === c.id);
    if (!list.length) return '';
    const rows = list.map(i => {
      const info = [detailText(i),
        i.note ? '备注：' + i.note : '',
        i.evidence ? '验收证据：' + i.evidence : '验收证据：未填写',
        Readiness.blockingReasons(i).length ? '阻断原因：' + Readiness.blockingReasons(i).join('；') : '',
        i.status === '不适用' && i.naReason ? '不适用理由：' + i.naReason : ''
      ].filter(Boolean).join('；');
      return '<tr><td>' + esc(i.title) + (i.critical ? ' <em>关键</em>' : '') + (i.example ? ' <em class="ex">示例</em>' : '') + '</td>' +
        '<td>' + esc(i.owner || '—') + '</td><td>' + esc(i.priority) + '</td><td>' + esc(i.due || '—') + '</td>' +
        '<td class="' + (RPT_ST[i.status] || '') + '">' + esc(i.status) + '</td><td>' + esc(info || '—') + '</td></tr>';
    }).join('');
    return '<h2>' + c.name + '<span class="cnt">' + list.length + ' 项 · 有效通过 ' + Readiness.evaluate(list).pass + '</span></h2>' +
      '<table><thead><tr><th style="width:26%">检查项</th><th style="width:10%">负责人</th><th style="width:9%">优先级</th>' +
      '<th style="width:12%">截止</th><th style="width:10%">状态</th><th>关键信息</th></tr></thead><tbody>' + rows + '</tbody></table>';
  }).join('');

  const blockedHtml = s.blockers.length
    ? '<ol class="blocked">' + s.blockers.map(i => '<li>' + esc(CAT_NAME[i.category]) + '｜' + esc(i.title) + '（' + esc(i.status) + '，负责人 ' + esc(i.owner || '未指派') + '）：' + esc(Readiness.blockingReasons(i).join('；')) + '</li>').join('') + '</ol>'
    : '';

  const info = verdictInfo(s);
  const verdictClass = info.kind, verdictText = info.title;

  return '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>项目上线检查报告</title><style>' +
    'body{font:13px/1.7 -apple-system,"PingFang SC","Microsoft YaHei",Segoe UI,sans-serif;color:#1a1d21;margin:0;background:#f4f6f8}' +
    '.page{max-width:1000px;margin:0 auto;background:#fff;padding:40px 46px 56px}' +
    'h1{font-size:22px;margin:0 0 4px}p,ul,ol{margin:0}' +
    '.meta{color:#67707c;font-size:12px;margin-bottom:22px}' +
    '.verdict{border:1px solid;border-radius:10px;padding:14px 18px;margin-bottom:18px}' +
    '.verdict.bad{border-color:#f2c7c7;background:#fdeded}.verdict.ok{border-color:#b7e4d0;background:#e8f7f1}' +
    '.verdict.warn{border-color:#f0ddb6;background:#fdf4e3}.meta,td{overflow-wrap:anywhere;white-space:pre-wrap}' +
    '.verdict strong{font-size:17px;display:block;margin-bottom:2px}.verdict.bad strong{color:#8e2626}.verdict.ok strong{color:#0a6b4a}' +
    '.blocked{margin:8px 0 0 18px;padding:0;color:#8e2626}.blocked li{margin:2px 0}' +
    '.ok-text{color:#0a6b4a;margin-top:6px}' +
    '.sum{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:26px}' +
    '.sum div{flex:1 1 130px;border:1px solid #e3e7ec;border-radius:10px;padding:10px 14px}' +
    '.sum b{display:block;font-size:19px}.sum span{color:#67707c;font-size:12px}' +
    'h2{font-size:15px;margin:24px 0 8px;padding-bottom:6px;border-bottom:2px solid #0e9f6e}' +
    'h2 .cnt{font-size:12px;color:#67707c;font-weight:400;margin-left:8px}' +
    'table{width:100%;border-collapse:collapse;font-size:12px}' +
    'th,td{border:1px solid #e3e7ec;padding:6px 8px;text-align:left;vertical-align:top}' +
    'th{background:#f7f9fa;color:#67707c;font-weight:500}' +
    'em{font-style:normal;font-size:11px;color:#0a7a54;background:#e8f7f1;border-radius:999px;padding:0 6px;margin-left:4px}' +
    'em.ex{color:#7a8494;background:#f4f6f8}' +
    '.r-pass{color:#0a7a54;font-weight:600}.r-fail{color:#a32b2b;font-weight:600}.r-doing{color:#2b6cb0}.r-na{color:#5b4b8a}' +
    '.foot{margin-top:28px;color:#67707c;font-size:12px;border-top:1px solid #e3e7ec;padding-top:10px}' +
    '.tip{background:#fdf4e3;border:1px solid #f0ddb6;color:#8a5a12;padding:8px 12px;border-radius:8px;font-size:12px;margin-bottom:16px}' +
    '.no-print{position:fixed;right:24px;top:24px;padding:9px 16px;border-radius:8px;border:1px solid #0e9f6e;background:#0e9f6e;color:#fff;cursor:pointer;font-size:13px}' +
    '@media print{.no-print{display:none}body{background:#fff}.page{padding:0}.sum div{break-inside:avoid}tr{break-inside:avoid}h2{break-after:avoid}}' +
    '</style></head><body><div class="page">' +
    '<button class="no-print" onclick="window.print()">打印 / 另存为 PDF</button>' +
    '<h1>项目上线前检查报告</h1>' +
    '<div class="meta">生成时间：' + dateStr + ' · 共 ' + s.total + ' 项检查 · 数据来源：本机浏览器记录</div>' +
    '<div class="tip">' + esc(contextText()) + '</div>' +
    (hasExample ? '<div class="tip">本报告包含标注为“示例”的演示数据，正式提交前请替换为真实检查记录。</div>' : '') +
    '<div class="verdict ' + verdictClass + '"><strong>' + verdictText + '</strong>' +
      '<div>' + esc(info.text) + '</div>' + blockedHtml + '</div>' +
    '<div class="sum">' +
      '<div><b>' + s.rate + '%</b><span>完成进度（通过 ' + s.pass + ' / 应完成 ' + (s.total - s.na) + '）</span></div>' +
      '<div><b>' + s.open + '</b><span>未完成项</span></div>' +
      '<div><b>' + s.severe + '</b><span>严重问题未关闭</span></div>' +
      '<div><b>' + s.blockers.length + '</b><span>阻断项</span></div>' +
      '<div><b>' + s.na + '</b><span>不适用项</span></div>' +
    '</div>' + cats +
    '<div class="foot">检查人 / 日期：____________________　　业务负责人确认：____________________</div>' +
    '</div></body></html>';
}

function exportReport() {
  download('上线检查报告_' + stamp() + '.html', buildReport(), 'text/html;charset=utf-8');
  toast('报告已导出，可用浏览器打开或打印为 PDF');
}

/* ================= 明细自动核对 ================= */
let autoResult = null;
let autoTimer = null;

const MAP_FIELDS = [
  {k: 'id', l: '单据 / 流程号'}, {k: 'qty', l: '数量 / 金额'},
  {k: 'project', l: '船次 / 工程编号'}, {k: 'dept', l: '专业 / 部门'},
  {k: 'period', l: '期间'}, {k: 'team', l: '施工队 / 车间'}, {k: 'line', l: '明细行号'}
];
const MAP_KW = {
  id: /单据|单号|流程号|工程单号|工单|订单|^id$|^编号$/i,
  qty: /数量|金额|产量|重量|^值$|qty|amount/i,
  project: /工程编号|船次|船舶|船名|项目|产线/,
  dept: /专业|部门|科室/,
  period: /期间|月份|年月|日期/,
  team: /施工队|施工单位|车间|班组/,
  line: /行号|明细号|序号/
};
const autoMapCache = {src: null, sys: null};
function toNum(v) { return Reconcile.toNum(v); }
function autoPrecision() { return Number(document.getElementById('autoPrecision').value); }
function roundValue(n) { return Reconcile.round(n, autoPrecision()); }
function fmtNum(n) {
  return n == null ? '—' : Reconcile.round(n, autoPrecision()).toLocaleString('zh-CN', {maximumFractionDigits: autoPrecision()});
}
function parseTable(text) { return Reconcile.parseTable(text, document.getElementById('autoHeader').checked); }
function readAutoMap(side) {
  const map = {};
  document.querySelectorAll('#autoMap select[data-side="' + side + '"]').forEach(s => { map[s.dataset.k] = Number(s.value); });
  return map;
}
function invalidateAuto() {
  autoResult = null;
  document.getElementById('autoRes').innerHTML = '';
  document.getElementById('autoErr').textContent = '';
  document.querySelector('[data-act="autoWrite"]').disabled = true;
}
function refreshAutoMap() {
  try {
    const tables = {src: parseTable(document.getElementById('autoSrc').value), sys: parseTable(document.getElementById('autoSys').value)};
    const previous = {src: readAutoMap('src'), sys: readAutoMap('sys')};
    document.getElementById('autoMap').innerHTML = ['src', 'sys'].map(side => {
      const table = tables[side];
      const signature = JSON.stringify([table.headers, document.getElementById('autoHeader').checked]);
      const same = autoMapCache[side] === signature;
      const used = new Set(), guesses = {};
      MAP_FIELDS.forEach(f => {
        const i = table.headers.findIndex((h, i) => !used.has(i) && MAP_KW[f.k].test(h));
        if (i >= 0) { guesses[f.k] = i; used.add(i); }
      });
      autoMapCache[side] = signature;
      return '<div class="map-title">' + (side === 'src' ? '源系统' : '系统内') + '列对应</div><div class="map-row">' + MAP_FIELDS.map(f => {
        const selected = same && previous[side][f.k] != null ? previous[side][f.k] : (guesses[f.k] == null ? -1 : guesses[f.k]);
        return '<div class="field"><label for="map_' + side + '_' + f.k + '">' + f.l + (f.k === 'id' || f.k === 'qty' ? ' *' : '') + '</label>' +
          '<select id="map_' + side + '_' + f.k + '" data-side="' + side + '" data-k="' + f.k + '">' +
          '<option value="-1"' + (selected === -1 ? ' selected' : '') + '>（不指定）</option>' +
          table.headers.map((h, i) => '<option value="' + i + '"' + (i === selected ? ' selected' : '') + '>' + esc(h) + '</option>').join('') + '</select></div>';
      }).join('') + '</div>';
    }).join('');
  } catch (e) { invalidateAuto(); document.getElementById('autoErr').textContent = e.message; }
}
function autoFingerprint() {
  return JSON.stringify([document.getElementById('autoSrc').value, document.getElementById('autoSys').value,
    document.getElementById('autoHeader').checked, autoPrecision(), readAutoMap('src'), readAutoMap('sys')]);
}
function anomTable(title, rows, cols, vals) {
  if (!rows.length) return '';
  return '<div class="res-title">' + esc(title) + '（' + rows.length + ' 条' + (rows.length > 20 ? '，仅显示前 20 条' : '') + '）</div>' +
    '<div class="res-scroll"><table class="res"><thead><tr>' + cols.map(c => '<th>' + esc(c) + '</th>').join('') + '</tr></thead><tbody>' +
    rows.slice(0, 20).map(r => '<tr>' + vals.map(v => '<td>' + esc(v(r)) + '</td>').join('') + '</tr>').join('') + '</tbody></table></div>';
}
function renderAutoResult() {
  if (!autoResult) return;
  const {src: a, sys: b, cmp} = autoResult;
  const cards = cmp ? [
    ['漏抓组合键', cmp.missing.length], ['多抓组合键', cmp.extra.length],
    ['明细内容不一致', cmp.mismatch.length], ['数据质量待确认', a.empty + b.empty + a.invalid + b.invalid + a.noId + b.noId + a.missingDimensions + b.missingDimensions]
  ] : [['单份明细行数', (b.rows ? b : a).rows], ['空值行数', (b.rows ? b : a).empty], ['非法数行数', (b.rows ? b : a).invalid], ['缺单号行数', (b.rows ? b : a).noId]];
  let html = '<div class="res-cards">' + cards.map(([l, v]) => '<div class="res-card' + (v && cmp ? ' alert' : '') + '"><b>' + v + '</b><span>' + esc(l) + '</span></div>').join('') + '</div>';
  html += '<div class="anom-note">' + (cmp ? '已按所选组合键匹配；结果只对本次粘贴范围负责。' : '仅提供单份数据，未核对漏抓、多抓或一致性。') +
    ' 空值、非法值不按 0 计算；真实 0 独立统计。核对精度 ' + autoResult.precision + ' 位。</div>';
  const metrics = [['明细行数', a.rows, b.rows], ['去重组合键数', a.uniq, b.uniq], ['正数合计', fmtNum(a.posSum), fmtNum(b.posSum)],
    ['负数合计', fmtNum(a.negSum), fmtNum(b.negSum)], ['零值行数', a.zero, b.zero], ['空值行数', a.empty, b.empty],
    ['非法数行数', a.invalid, b.invalid], ['缺单号行数', a.noId, b.noId], ['已选维度缺值行数', a.missingDimensions, b.missingDimensions], ['同组合键多行（需核实行号）', a.dupIds, b.dupIds]];
  html += '<table class="res"><thead><tr><th>指标</th><th>源系统' + (!a.rows ? '（未提供）' : '') + '</th><th>系统内' + (!b.rows ? '（未提供）' : '') + '</th></tr></thead><tbody>' +
    metrics.map(([l, v, w]) => '<tr><td>' + l + '</td><td class="num">' + (a.rows ? v : '—') + '</td><td class="num">' + (b.rows ? w : '—') + '</td></tr>').join('') + '</tbody></table>';
  const keys = [...new Set([...a.groups.keys(), ...b.groups.keys()])];
  html += anomTable('按已选维度汇总', keys, ['范围', '源行数', '源合计', '系统行数', '系统合计'], [k => a.groups.get(k)?.label || b.groups.get(k)?.label || k,
    k => a.groups.get(k)?.rows ?? '—', k => a.groups.has(k) ? fmtNum(a.groups.get(k).sum) : '—',
    k => b.groups.get(k)?.rows ?? '—', k => b.groups.has(k) ? fmtNum(b.groups.get(k).sum) : '—']);
  if (cmp) {
    html += anomTable('漏抓明细', cmp.missing, ['单据及维度', '源合计'], [r => r.label || r.id, r => fmtNum(r.qty)]);
    html += anomTable('多抓明细', cmp.extra, ['单据及维度', '系统合计'], [r => r.label || r.id, r => fmtNum(r.qty)]);
    html += anomTable('明细内容不一致', cmp.mismatch, ['单据及维度', '原因', '源合计', '系统合计', '净差'],
      [r => r.label || r.id, r => r.reason, r => fmtNum(r.src), r => fmtNum(r.sys), r => fmtNum(r.diff)]);
  }
  ['src', 'sys'].forEach(side => {
    const st = autoResult[side], name = side === 'src' ? '源系统' : '系统内';
    const repeated = [...st.ids].filter(([k, n]) => n > 1);
    html += anomTable(name + '同组合键多行（请核实是否应补选明细行号）', repeated, ['单据及维度', '行数'], [r => st.labels.get(r[0]), r => r[1]]);
    const missing = r => MAP_FIELDS.filter(f => !['id', 'qty'].includes(f.k) && autoResult.maps[side][f.k] >= 0 && !r[f.k]).map(f => f.l);
    html += anomTable(name + '数据质量待确认', st.recs.filter(r => r.valueState !== 'number' || !r.id || missing(r).length), ['数据行', '单据及维度', '原值', '说明'],
      [r => r.row, r => r.label, r => r.rawQty, r => [!r.id ? '缺单号' : '', r.valueState === 'empty' ? '数值为空' : r.valueState === 'invalid' ? '非法数值' : '',
        missing(r).length ? '缺维度：' + missing(r).join('、') : ''].filter(Boolean).join('；')]);
  });
  document.getElementById('autoRes').innerHTML = html;
}
function runAutoCheck() {
  clearTimeout(autoTimer);
  refreshAutoMap();
  invalidateAuto();
  try {
    const srcText = document.getElementById('autoSrc').value, sysText = document.getElementById('autoSys').value;
    if (!srcText.trim() && !sysText.trim()) throw new Error('请至少粘贴一份明细数据');
    const src = parseTable(srcText), sys = parseTable(sysText);
    if ((srcText.trim() && !src.rows.length) || (sysText.trim() && !sys.rows.length)) throw new Error('已粘贴的数据没有明细行，请检查表头设置');
    const maps = {src: readAutoMap('src'), sys: readAutoMap('sys')};
    if (src.rows.length && sys.rows.length) {
      MAP_FIELDS.filter(f => !['id', 'qty'].includes(f.k)).forEach(f => {
        if ((maps.src[f.k] >= 0) !== (maps.sys[f.k] >= 0)) throw new Error('两边都需选择“' + f.l + '”，或两边都不指定');
      });
    }
    const emptyMap = {id: 0, qty: 1};
    const a = Reconcile.analyze(src, src.rows.length ? maps.src : emptyMap), b = Reconcile.analyze(sys, sys.rows.length ? maps.sys : emptyMap);
    const precision = autoPrecision(), cmp = a.rows && b.rows ? Reconcile.compareStats(a, b, {precision}) : null;
    const issues = a.empty + b.empty + a.invalid + b.invalid + a.noId + b.noId + a.missingDimensions + b.missingDimensions + (cmp ? cmp.missing.length + cmp.extra.length + cmp.mismatch.length : 0);
    autoResult = {src: a, sys: b, cmp, issues, maps, precision, at: new Date(), fingerprint: autoFingerprint(), scope: contextText()};
    renderAutoResult();
    document.querySelector('[data-act="autoWrite"]').disabled = false;
  } catch (e) { invalidateAuto(); document.getElementById('autoErr').textContent = e.message; }
}
function autoNote() {
  const {src: a, sys: b, cmp, precision} = autoResult;
  const one = b.rows ? b : a;
  const dimensions = MAP_FIELDS.filter(f => !['id', 'qty'].includes(f.k) && autoResult.maps[b.rows ? 'sys' : 'src'][f.k] >= 0).map(f => f.l);
  const ranges = ['src', 'sys'].filter(side => autoResult[side].rows).map(side => (side === 'src' ? '源系统' : '系统内') + '实际范围：' + MAP_FIELDS.filter(f => !['id', 'qty'].includes(f.k)).map(f =>
    f.l + '＝' + (autoResult.maps[side][f.k] >= 0 ? JSON.stringify([...new Set(autoResult[side].recs.map(r => r[f.k] || '（空）'))]) : '未选列，未核查')).join('；')).join('\n');
  return '自动核对 ' + autoResult.at.toLocaleString('zh-CN', {hour12: false}) + '：' + autoResult.scope + '\n' +
    '源 ' + (a.rows || '未提供') + ' 行 / 系统 ' + (b.rows || '未提供') + ' 行；匹配键：单据号' + (dimensions.length ? ' + ' + dimensions.join(' + ') : '') + '；精度 ' + precision + ' 位\n' +
    (b.rows ? '系统内' : '源系统单份') + '正数合计 ' + fmtNum(one.posSum) + '，负数合计 ' + fmtNum(one.negSum) + '，零值 ' + one.zero + '，空值 ' + one.empty + '，非法值 ' + one.invalid + '\n' +
    (cmp ? '漏抓 ' + cmp.missing.length + '，多抓 ' + cmp.extra.length + '，内容不一致 ' + cmp.mismatch.length : '仅单份数据，未核对两边一致性') +
    '；数据质量及差异共 ' + autoResult.issues + ' 项（可同一行涉及多项）。需人工核实取数范围、单位、流程状态和多行组合键。\n' + ranges;
}
function renderAutoTarget() {
  const dataItems = state.items.filter(i => i.category === 'data');
  document.getElementById('autoTarget').innerHTML = '<option value="new">（新建一条数据核对项）</option>' +
    dataItems.map(i => '<option value="' + esc(i.id) + '">更新：' + esc(i.title) + '</option>').join('');
}
function writeAutoResult() {
  const err = document.getElementById('autoErr');
  if (!autoResult || autoResult.fingerprint !== autoFingerprint()) { invalidateAuto(); err.textContent = '数据或列对应已变化，请重新核对后写入'; return; }
  const target = document.getElementById('autoTarget').value, isNew = target === 'new';
  const {src: a, sys: b} = autoResult, one = b.rows ? b : a;
  const it = isNew ? mk('data', '修船明细核对 ' + stamp(), {critical: true, priority: '高'}) : state.items.find(i => i.id === target);
  if (!it) { err.textContent = '未找到目标检查项'; return; }
  if (isNew) state.items.push(it);
  it.detailCount = a.rows ? String(a.rows) : '';
  it.summaryCount = b.rows ? String(b.rows) : '';
  it.posSum = String(roundValue(one.posSum)); it.negSum = String(roundValue(one.negSum)); it.zeroCount = String(one.zero);
  ['project', 'dept', 'period', 'team'].forEach(k => {
    if (!(autoResult.maps[b.rows ? 'sys' : 'src'][k] >= 0)) return;
    const values = [...new Set(one.recs.map(x => x[k]).filter(Boolean))];
    it[k] = values.length === 1 ? values[0] : values.length ? '多个（见核对备注）' : '';
  });
  it.note = [it.note, autoNote()].filter(Boolean).join('\n\n');
  const ranges = {};
  ['src', 'sys'].forEach(side => {
    ranges[side] = {};
    MAP_FIELDS.filter(f => !['id', 'qty'].includes(f.k) && autoResult.maps[side][f.k] >= 0).forEach(f => {
      ranges[side][f.k] = [...new Set(autoResult[side].recs.map(r => r[f.k]))];
    });
  });
  it.reconciliation = {issues: autoResult.issues, both: !!autoResult.cmp, precision: autoResult.precision, at: autoResult.at.toISOString(), ranges};
  it.status = '进行中'; it.updatedAt = Date.now();
  save(); closeAuto(); renderAll();
  toast(isNew ? '已创建核对记录，待人工确认' : '已更新统计并改为进行中，待人工确认');
}

function openAuto() {
  invalidateAuto();
  renderAutoTarget();
  refreshAutoMap();
  document.getElementById('autoOverlay').hidden = false;
  document.body.style.overflow = 'hidden';
}

function closeAuto() {
  document.getElementById('autoOverlay').hidden = true;
  document.body.style.overflow = '';
}


/* ================= 事件绑定 ================= */
function bindEvents() {
  document.addEventListener('click', e => {
    const el = e.target.closest('[data-act]');
    if (!el) return;
    const act = el.dataset.act;
    const itemEl = e.target.closest('.item');
    const id = itemEl ? itemEl.dataset.id : null;

    if (act === 'addTemplate') { addTemplate(); }
    else if (act === 'add') { e.preventDefault(); openModal(null, el.dataset.cat); }
    else if (act === 'edit') { if (id) openModal(id); }
    else if (act === 'quickPass') {
      const it = state.items.find(i => i.id === id);
      if (!it) return;
      const passReasons = Readiness.blockingReasons(Object.assign({}, it, {status: '通过'}));
      if (passReasons.length) { openModal(it.id); document.getElementById('formErr').textContent = passReasons.join('；'); return; }
      const prev = {status: it.status, updatedAt: it.updatedAt};
      it.status = '通过';
      it.updatedAt = Date.now();
      save(); renderAll();
      toast('已标记通过：' + it.title, {
        label: '撤销',
        fn: () => { Object.assign(it, prev); save(); renderAll(); }
      });
    }
    else if (act === 'del') {
      const idx = state.items.findIndex(i => i.id === id);
      if (idx < 0) return;
      const it = state.items[idx];
      if (confirm('确定删除「' + it.title + '」？删除后 6 秒内可撤销。')) {
        state.items.splice(idx, 1);
        save(); renderAll();
        toast('已删除「' + it.title + '」', {
          label: '撤销',
          fn: () => {
            state.items.splice(Math.min(idx, state.items.length), 0, it);
            save(); renderAll();
            toast('已恢复');
          }
        });
      }
    }
    else if (act === 'close') { closeModal(); }
    else if (act === 'save') { submitForm(); }
    else if (act === 'backup') { backupJson(); }
    else if (act === 'import') { document.getElementById('fileInput').click(); }
    else if (act === 'report') { exportReport(); }
    else if (act === 'clearExample') {
      const n = state.items.filter(i => i.example).length;
      if (confirm('将删除 ' + n + ' 条示例数据，是否继续？')) {
        state.items = state.items.filter(i => !i.example);
        save(); renderAll(); toast('示例数据已清除');
      }
    }
    else if (act === 'auto') { openAuto(); }
    else if (act === 'autoClose') { closeAuto(); }
    else if (act === 'autoRun') { runAutoCheck(); }
    else if (act === 'autoWrite') { writeAutoResult(); }
  });

  document.addEventListener('change', e => {
    const catSel = e.target.closest('#f_category');
    if (catSel) { toggleCatFields(catSel.value); return; }

    const stSel = e.target.closest('select[data-act="status"]');
    if (stSel) {
      const itemEl = stSel.closest('.item');
      const it = state.items.find(i => i.id === itemEl.dataset.id);
      if (!it) return;
      if (stSel.value === '通过') {
        const reasons = Readiness.blockingReasons(Object.assign({}, it, {status: '通过'}));
        if (reasons.length) {
          stSel.value = it.status;
          openModal(it.id);
          document.querySelector('#modalBody [name="f_status"]').value = '通过';
          document.getElementById('formErr').textContent = reasons.join('；');
          return;
        }
      }
      if (stSel.value === '不适用' && !it.naReason) {
        openModal(it.id);
        const s2 = document.querySelector('#modalBody [name="f_status"]');
        if (s2) s2.value = '不适用';
        document.getElementById('formErr').textContent = '请填写不适用理由后再保存';
        return;
      }
      it.status = stSel.value;
      it.updatedAt = Date.now();
      save(); renderAll();
      return;
    }

    const fStatus = e.target.closest('#fStatus');
    if (fStatus) { state.filter.status = fStatus.value; renderList(); return; }
    const fCat = e.target.closest('#fCat');
    if (fCat) { state.filter.cat = fCat.value; renderList(); return; }
    const fOwner = e.target.closest('#fOwner');
    if (fOwner) { state.filter.owner = fOwner.value; renderList(); return; }
    const fSort = e.target.closest('#fSort');
    if (fSort) { state.filter.sort = fSort.value; renderList(); return; }
    const fOpen = e.target.closest('#fOpen');
    if (fOpen) { state.filter.onlyOpen = fOpen.checked; renderList(); return; }
    const fDue = e.target.closest('#fDue');
    if (fDue) { state.filter.onlyOverdue = fDue.checked; renderList(); }
  });

  document.getElementById('fQ').addEventListener('input', e => {
    state.filter.q = e.target.value;
    renderList();
  });
  document.querySelectorAll('[data-context]').forEach(el => el.addEventListener('input', () => {
    state.context[el.dataset.context] = el.value.trim();
    save(); renderVerdict();
  }));

  document.getElementById('fReset').addEventListener('click', () => {
    state.filter = {cat: 'all', owner: 'all', status: 'all', sort: 'default', q: '', onlyOpen: false, onlyOverdue: false};
    document.getElementById('fQ').value = '';
    document.getElementById('fOpen').checked = false;
    document.getElementById('fDue').checked = false;
    renderAll();
  });

  document.getElementById('overlay').addEventListener('click', e => {
    if (e.target.id === 'overlay') closeModal();
  });
  document.getElementById('autoOverlay').addEventListener('click', e => {
    if (e.target.id === 'autoOverlay') closeAuto();
  });

  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (!document.getElementById('overlay').hidden) closeModal();
    else if (!document.getElementById('autoOverlay').hidden) closeAuto();
  });

  const scheduleAuto = () => {
    invalidateAuto();
    clearTimeout(autoTimer);
    autoTimer = setTimeout(refreshAutoMap, 250);
  };
  document.getElementById('autoSrc').addEventListener('input', scheduleAuto);
  document.getElementById('autoSys').addEventListener('input', scheduleAuto);
  document.getElementById('autoHeader').addEventListener('change', () => {
    invalidateAuto();
    refreshAutoMap();
  });
  document.getElementById('autoMap').addEventListener('change', invalidateAuto);
  document.getElementById('autoPrecision').addEventListener('change', invalidateAuto);

  document.getElementById('fileInput').addEventListener('change', e => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        const items = Array.isArray(data) ? data : (data && data.items);
        if (!Array.isArray(items)) throw new Error('文件格式不正确，应包含 items 数组');
        if (!confirm('将导入 ' + items.length + ' 条检查项，并覆盖当前数据。建议先导出备份，是否继续？')) return;
        state.items = items.map(normalizeItem);
        restoreContext(data.context);
        renderContext();
        save(); renderAll();
        toast('导入成功，共 ' + state.items.length + ' 项');
      } catch (err) {
        alert('导入失败：' + err.message);
      } finally {
        e.target.value = '';
      }
    };
    reader.readAsText(file, 'utf-8');
  });
}

/* ================= 启动 ================= */
(function init() {
  const stored = load();
  if (stored !== null) {
    state.items = stored.map(normalizeItem);
    document.getElementById('savedTip').textContent = '本地数据已载入';
  } else {
    state.items = seedItems();
    save();
  }
  bindEvents();
  renderContext();
  document.getElementById('templateSelect').innerHTML = window.SHIPREPAIR_TEMPLATES.map(t => '<option value="' + esc(t.id) + '">' + esc(t.name) + '（' + t.items.length + ' 项）</option>').join('');
  renderAll();
})();
