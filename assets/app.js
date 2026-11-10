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
    {k: 'project', l: '项目 / 产线', t: 'text', ph: '如：一号线'},
    {k: 'dept', l: '部门', t: 'text', ph: '如：生产部'},
    {k: 'period', l: '期间', t: 'text', ph: '如：2026-10'},
    {k: 'detailCount', l: '明细条数', t: 'number', ph: '12480'},
    {k: 'summaryCount', l: '汇总条数', t: 'number', ph: '12480'},
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
  return [
    /* ---- 业务规则确认 ---- */
    mk('rule', '数据来源与接口清单', {owner: '张伟', priority: '高', due: '2026-11-03', status: '通过', critical: true,
      confirmOwner: '李强（生产部）', basis: '《采集口径确认单 v1.2》第 1 章',
      note: '含 MES 手工补录单，需确认是否计入产量', example: true}),
    mk('rule', '抓取条件与单据状态', {owner: '张伟', priority: '高', due: '2026-11-03', status: '通过', critical: true,
      confirmOwner: '李强（生产部）', basis: '口径确认单第 2 章：仅取已审核/已过账单据，草稿不计',
      example: true}),
    mk('rule', '正负数含义（退货、冲销、红字）', {owner: '张伟', priority: '高', due: '2026-11-04', status: '进行中', critical: true,
      confirmOwner: '待财务部陈敏确认', basis: '财务 2026-10-28 邮件：退回单应为负数，红字冲销同负',
      note: '尚未签字，仅口头确认', example: true}),
    mk('rule', '0 与空值处理', {owner: '张伟', priority: '高', due: '2026-11-04', status: '待处理', critical: true,
      basis: '待确认：0 是真实值还是采集失败？空值是否补 0？',
      note: '上次上线就栽在这里，必须写清楚', example: true}),
    mk('rule', '日期口径（跨零点、跨月归属）', {owner: '周敏', priority: '高', due: '2026-11-05', status: '进行中',
      confirmOwner: '李强（生产部）', basis: '按单据业务日期归属；跨零点班次待生产部确认',
      example: true}),
    mk('rule', '单位与精度（kW/kWh、t/kg、小数位）', {owner: '周敏', priority: '中', due: '2026-11-05', status: '通过',
      confirmOwner: '能源部 赵海', basis: '设备台账与能源部 10-25 确认：电量 kWh，保留 2 位小数', example: true}),
    mk('rule', '去重规则与修改/撤回后的处理', {owner: '周敏', priority: '中', due: '2026-11-06', status: '通过',
      confirmOwner: '李强（生产部）', basis: '同单据号按最新版本覆盖，历史版本留痕；撤回单作废不计', example: true}),

    /* ---- 关键测试 ---- */
    mk('test', '正数场景', {owner: '王倩', priority: '高', due: '2026-11-02', status: '通过', critical: true,
      steps: '1. 造正常入库单 10 条\n2. 执行采集\n3. 核对明细与汇总', expected: '10 条全部采集，合计 +100', actual: '10 条全部采集，合计 +100，一致',
      example: true}),
    mk('test', '负数场景（退货/冲销）', {owner: '王倩', priority: '高', due: '2026-11-02', status: '不通过', critical: true,
      steps: '1. 造退货单（数量 -10）\n2. 执行采集\n3. 查看明细值与汇总负数合计', expected: '明细 -10，负数合计减少 10', actual: '明细显示 0，负数合计未变化',
      note: '已提缺陷 #1', example: true}),
    mk('test', '0 值场景', {owner: '王倩', priority: '高', due: '2026-11-03', status: '待处理', critical: true,
      steps: '1. 造数量为 0 的单据\n2. 执行采集', expected: '按业务口径保留 0 行，且不与空值混淆', actual: '',
      example: true}),
    mk('test', '空值与字段缺失', {owner: '王倩', priority: '高', due: '2026-11-03', status: '待处理', critical: true,
      steps: '1. 造字段为空的单据（数量为空、部门为空）\n2. 执行采集', expected: '按口径置空或跳过，并记录异常日志', actual: '',
      example: true}),
    mk('test', '正负抵消', {owner: '王倩', priority: '中', due: '2026-11-04', status: '通过',
      steps: '同一物料先入库 +50 再退货 -50', expected: '净额 0，明细保留两行', actual: '净额 0，两行明细均保留',
      example: true}),
    mk('test', '小数边界与四舍五入', {owner: '王倩', priority: '中', due: '2026-11-04', status: '通过',
      steps: '输入 0.005、1.005、999999.995 等边界值', expected: '按银行家舍入或业务约定统一处理', actual: '与财务口径一致',
      example: true}),
    mk('test', '跨月与期初期末', {owner: '王倩', priority: '中', due: '2026-11-05', status: '进行中',
      steps: '10-31 23:50 录单、11-01 00:10 采集', expected: '按业务日期归入 10 月', actual: '待补测',
      example: true}),
    mk('test', '撤回重提、重复运行、失败重试', {owner: '王倩', priority: '中', due: '2026-11-05', status: '通过',
      steps: '1. 采集后撤回单据并重提\n2. 重复执行采集 3 次\n3. 人为中断后再重试', expected: '不产生重复行，最终数据与单据一致', actual: '重复运行 3 次无重复，重试后数据一致',
      example: true}),

    /* ---- 数据核对 ---- */
    mk('data', '明细与汇总条数核对（漏抓）', {owner: '刘洋', priority: '高', due: '2026-11-03', status: '通过',
      project: '一号线', dept: '生产部', period: '2026-10', detailCount: '12480', summaryCount: '12480',
      posSum: '85320.5', negSum: '-1240', zeroCount: '0', note: '源系统导出 12480 条，系统 12480 条',
      example: true}),
    mk('data', '多抓与重复数据核对', {owner: '刘洋', priority: '高', due: '2026-11-03', status: '通过',
      project: '一号线', dept: '生产部', period: '2026-10', detailCount: '12480', summaryCount: '12480',
      zeroCount: '0', note: '按单据号去重后无重复', example: true}),
    mk('data', '字段错误抽查（数量、金额、单位）', {owner: '刘洋', priority: '中', due: '2026-11-04', status: '进行中',
      project: '二号线', dept: '生产部', period: '2026-10', detailCount: '3120', summaryCount: '3120',
      note: '抽查 200 条，已发现 3 条单位不一致', example: true}),
    mk('data', '正数合计、负数合计与零值行数对比', {owner: '刘洋', priority: '高', due: '2026-11-05', status: '进行中',
      project: '全部', dept: '财务', period: '2026-10', posSum: '85320.5', negSum: '-1240', zeroCount: '17',
      note: '零值 17 行需业务确认是真实 0 还是采集失败', example: true}),

    /* ---- 问题闭环 ---- */
    mk('issue', '退货负数在汇总中被计为 0', {owner: '王倩', priority: '高', due: '2026-11-04', status: '不通过',
      repro: '录入退货单（数量 -10）→ 执行采集 → 查看汇总', diff: '预期 -10，实际 0；影响 10 月产量与成本报表',
      severity: '严重', devOwner: '王磊', fixVersion: 'V2.3.1', retest: '未复测', impact: '是（产量、成本报表均受影响）',
      history: '待处理', example: true}),
    mk('issue', '跨零点班次数据归属错误', {owner: '王倩', priority: '高', due: '2026-11-05', status: '进行中',
      repro: '23:50 录单，次日 00:10 采集', diff: '预期归 10 月，实际归 11 月', severity: '严重',
      devOwner: '王磊', fixVersion: '待排期', retest: '未复测', impact: '是（影响月度产量）', history: '待处理',
      example: true}),
    mk('issue', '导出报表表头错位', {owner: '刘洋', priority: '中', due: '2026-10-30', status: '通过',
      repro: '导出 10 月产量报表', diff: '表头与列错位一列', severity: '一般', devOwner: '陈晨',
      fixVersion: 'V2.3.0', retest: '通过', impact: '否', history: '不涉及', example: true}),
    mk('issue', '设备离线期间重复计数', {owner: '刘洋', priority: '中', due: '2026-11-06', status: '待处理',
      repro: '断开采集网关 10 分钟后再恢复', diff: '恢复后补传数据与在线数据重复', severity: '一般',
      devOwner: '待指派', retest: '未复测', impact: '待评估', history: '待处理', example: true}),

    /* ---- 上线准备 ---- */
    mk('launch', '核心业务流程验收（采集→汇总→报表）', {owner: '张伟', priority: '高', due: '2026-11-06', status: '进行中',
      note: '需在试运行环境完整走一遍', example: true}),
    mk('launch', '版本与配置核对', {owner: '周敏', priority: '高', due: '2026-11-06', status: '待处理',
      version: 'V2.3.1', note: '含采集参数、字典、权限配置', example: true}),
    mk('launch', '业务负责人上线确认', {owner: '张伟', priority: '高', due: '2026-11-07', status: '待处理',
      bizOwner: '李强（生产部）', note: '需书面确认', example: true}),
    mk('launch', '遗留问题处理与上线决策', {owner: '张伟', priority: '高', due: '2026-11-07', status: '待处理',
      note: '逐条明确：修复 / 带风险上线（含规避方案）/ 延期', example: true}),
    mk('launch', '备份与回滚方案', {owner: '周敏', priority: '中', due: '2026-11-07', status: '通过',
      rollback: '上线前全量备份，异常时 30 分钟内回滚到上一版本', example: true}),
    mk('launch', '上线后 24 小时关键检查项', {owner: '刘洋', priority: '中', due: '2026-11-08', status: '待处理',
      postCheck: '首日对账（条数/正负合计/零值行数）、异常日志巡检、业务反馈收集', example: true})
  ];
}
/* ================= 状态与存储 ================= */
const state = {
  items: [],
  filter: {cat: 'all', owner: 'all', status: 'all', sort: 'default', q: '', onlyOpen: false, onlyOverdue: false}
};
let editingId = null;

function save() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({v: 1, updatedAt: Date.now(), items: state.items}));
    document.getElementById('savedTip').textContent = '已自动保存 ' + nowText();
  } catch (e) {
    toast('保存失败：浏览器本地存储不可用');
  }
}
function load() {
  try {
    const data = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
    if (data && Array.isArray(data.items)) return data.items;
  } catch (e) { /* 数据损坏时退回示例 */ }
  return null;
}

/* ================= 判定逻辑 ================= */
function isBlocking(it) {
  if (it.status === '通过' || it.status === '不适用') return false;
  if (it.category === 'issue') return it.severity === '严重';
  if (it.category === 'rule' || it.category === 'test') return !!it.critical;
  return false;
}

function stats() {
  const items = state.items;
  const total = items.length;
  const pass = items.filter(i => i.status === '通过').length;
  const na = items.filter(i => i.status === '不适用').length;
  const open = items.filter(i => i.status === '待处理' || i.status === '进行中' || i.status === '不通过').length;
  const severe = items.filter(i => i.category === 'issue' && i.severity === '严重' && i.status !== '通过' && i.status !== '不适用').length;
  const blockers = items.filter(isBlocking);
  const overdue = items.filter(i => { const d = dueInfo(i); return d && d.overdue; }).length;
  const base = total - na;
  const rate = base > 0 ? Math.round(pass / base * 100) : 100;
  return {total, pass, na, open, severe, blockers, rate, overdue};
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
    const scope = [it.project, it.dept, it.period].filter(Boolean).join(' / ');
    if (scope) parts.push(scope);
    const d = num(it.detailCount), s = num(it.summaryCount);
    if (d !== null && s !== null) parts.push('明细 ' + d + ' / 汇总 ' + s + ' 条（差 ' + (d - s) + '）');
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
  const groups = [
    {name: '关键规则未确认', list: s.blockers.filter(i => i.category === 'rule')},
    {name: '核心测试未通过', list: s.blockers.filter(i => i.category === 'test')},
    {name: '严重缺陷未关闭', list: s.blockers.filter(i => i.category === 'issue')}
  ].filter(g => g.list.length);

  const el = document.getElementById('verdict');
  if (!s.blockers.length) {
    el.className = 'verdict ok';
    el.innerHTML = '<div class="v-icon">&#10003;</div><div class="v-body">' +
      '<div class="v-title">暂未发现阻断项</div>' +
      '<div class="v-sub">关键规则、核心测试与严重缺陷均已通过，请再确认上线准备项后提交上线审批。</div>' +
      '</div>';
    return;
  }
  const summary = groups.map(g => g.name + ' ' + g.list.length + ' 项').join(' · ');
  const chips = docs => docs.map(i => {
    const st = i.status === '不通过' ? '不通过' : i.status;
    return '<li>' + esc(CAT_NAME[i.category]) + '｜' + esc(i.title) + '（' + esc(st) + '）</li>';
  }).join('');
  el.className = 'verdict bad';
  el.innerHTML = '<div class="v-icon">!</div><div class="v-body">' +
    '<div class="v-title">暂不具备上线条件</div>' +
    '<div class="v-sub">共 ' + s.blockers.length + ' 项阻断：' + summary + '</div>' +
    '<ul class="v-list">' + chips(s.blockers) + '</ul>' +
    '</div>';
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
  return '<div class="item" data-id="' + it.id + '">' +
    '<div class="item-main" data-act="edit">' +
      '<div class="item-title-row">' +
        '<span class="item-title' + (it.status === '通过' ? ' done' : '') + '">' + hl(it.title || '（未命名检查项）') + '</span>' +
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
    if (f.onlyOpen && !(it.status === '待处理' || it.status === '进行中' || it.status === '不通过')) return false;
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
    const pass = all.filter(i => i.status === '通过').length;
    const rate = all.length ? Math.round(pass / all.length * 100) : 0;
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
    '<div class="field"><label>是否关键项</label><label class="chk" style="margin-top:9px"><input type="checkbox" name="f_critical"' + (draft.critical ? ' checked' : '') + '> 规则 / 测试类关键项，未通过将阻断上线</label></div>' +
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
    project: v.project, dept: v.dept, period: v.period,
    detailCount: v.detailCount, summaryCount: v.summaryCount,
    posSum: v.posSum, negSum: v.negSum, zeroCount: v.zeroCount,
    repro: v.repro, diff: v.diff, severity: v.severity, devOwner: v.devOwner, fixVersion: v.fixVersion,
    retest: v.retest, impact: v.impact, history: v.history,
    version: v.version, bizOwner: v.bizOwner, rollback: v.rollback, postCheck: v.postCheck,
    updatedAt: Date.now()
  };

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
    JSON.stringify({app: 'launch-check-assistant', version: 1, exportedAt: new Date().toISOString(), items: state.items}, null, 2),
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
        i.status === '不适用' && i.naReason ? '不适用理由：' + i.naReason : ''
      ].filter(Boolean).join('；');
      return '<tr><td>' + esc(i.title) + (i.critical ? ' <em>关键</em>' : '') + (i.example ? ' <em class="ex">示例</em>' : '') + '</td>' +
        '<td>' + esc(i.owner || '—') + '</td><td>' + esc(i.priority) + '</td><td>' + esc(i.due || '—') + '</td>' +
        '<td class="' + (RPT_ST[i.status] || '') + '">' + esc(i.status) + '</td><td>' + esc(info || '—') + '</td></tr>';
    }).join('');
    return '<h2>' + c.name + '<span class="cnt">' + list.length + ' 项 · 通过 ' + list.filter(i => i.status === '通过').length + '</span></h2>' +
      '<table><thead><tr><th style="width:26%">检查项</th><th style="width:10%">负责人</th><th style="width:9%">优先级</th>' +
      '<th style="width:12%">截止</th><th style="width:10%">状态</th><th>关键信息</th></tr></thead><tbody>' + rows + '</tbody></table>';
  }).join('');

  const blockedHtml = s.blockers.length
    ? '<ol class="blocked">' + s.blockers.map(i => '<li>' + esc(CAT_NAME[i.category]) + '｜' + esc(i.title) + '（' + esc(i.status) + '，负责人 ' + esc(i.owner || '未指派') + '）</li>').join('') + '</ol>'
    : '<p class="ok-text">未发现阻断项。</p>';

  const verdictClass = s.blockers.length ? 'bad' : 'ok';
  const verdictText = s.blockers.length ? '暂不具备上线条件' : '暂未发现阻断项';

  return '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>项目上线检查报告</title><style>' +
    'body{font:13px/1.7 -apple-system,"PingFang SC","Microsoft YaHei",Segoe UI,sans-serif;color:#1a1d21;margin:0;background:#f4f6f8}' +
    '.page{max-width:1000px;margin:0 auto;background:#fff;padding:40px 46px 56px}' +
    'h1{font-size:22px;margin:0 0 4px}p,ul,ol{margin:0}' +
    '.meta{color:#67707c;font-size:12px;margin-bottom:22px}' +
    '.verdict{border:1px solid;border-radius:10px;padding:14px 18px;margin-bottom:18px}' +
    '.verdict.bad{border-color:#f2c7c7;background:#fdeded}.verdict.ok{border-color:#b7e4d0;background:#e8f7f1}' +
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
    (hasExample ? '<div class="tip">本报告包含标注为“示例”的演示数据，正式提交前请替换为真实检查记录。</div>' : '') +
    '<div class="verdict ' + verdictClass + '"><strong>' + verdictText + '</strong>' +
      '<div>' + (s.blockers.length ? '共 ' + s.blockers.length + ' 项阻断' : '关键规则、核心测试与严重缺陷均已通过') + '</div>' + blockedHtml + '</div>' +
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
  {k: 'id', l: '单据号'},
  {k: 'qty', l: '数量'},
  {k: 'project', l: '项目'},
  {k: 'dept', l: '部门'},
  {k: 'period', l: '期间'}
];
const MAP_KW = {
  id: /单号|单据|编号|工单|订单/i,
  qty: /数量|金额|产量|重量|值|qty|amount/i,
  project: /项目|产线|车间|线体/,
  dept: /部门|班组|科室/,
  period: /期间|月份|日期|年月/
};

function toNum(v) {
  if (v == null) return null;
  const s = String(v).replace(/[\s,，¥￥]/g, '');
  if (s === '') return null;
  const n = Number(s);
  return isNaN(n) ? null : n;
}
function round2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }
function fmtNum(n) {
  const r = round2(n);
  return r.toLocaleString('zh-CN', {maximumFractionDigits: 2});
}

function parseTable(text) {
  const raw = String(text || '').replace(/\r/g, '').split('\n').filter(l => l.trim() !== '');
  if (!raw.length) return {headers: [], rows: [], cols: 0};
  const delim = raw[0].indexOf('\t') >= 0 ? '\t' : ',';
  const cells = raw.map(l => l.split(delim).map(c => c.trim().replace(/^"(.*)"$/, '$1')));
  const cols = Math.max.apply(null, cells.map(r => r.length));
  const withHeader = document.getElementById('autoHeader').checked;
  let headers, rows;
  if (withHeader) {
    headers = cells[0].slice();
    rows = cells.slice(1);
  } else {
    headers = Array.from({length: cols}, (_, i) => '第' + (i + 1) + '列');
    rows = cells;
  }
  while (headers.length < cols) headers.push('第' + (headers.length + 1) + '列');
  rows = rows.map(r => {
    const a = r.slice();
    while (a.length < cols) a.push('');
    return a;
  });
  return {headers, rows, cols};
}

function colRatio(table, idx, numeric) {
  const vals = table.rows.map(r => String(r[idx] || '').trim()).filter(Boolean);
  if (!vals.length) return 0;
  if (numeric) return vals.filter(v => toNum(v) !== null).length / vals.length;
  return new Set(vals).size / vals.length;
}

function refreshAutoMap() {
  const src = parseTable(document.getElementById('autoSrc').value);
  const sys = parseTable(document.getElementById('autoSys').value);
  const cols = Math.max(src.cols, sys.cols);
  const ref = sys.cols >= src.cols ? sys : src;
  const prev = {};
  document.querySelectorAll('#autoMap select').forEach(s => { prev[s.dataset.k] = s.value; });

  if (!cols) {
    document.querySelectorAll('#autoMap select').forEach(s => {
      s.innerHTML = '<option value="-1">（无数据）</option>';
    });
    return;
  }
  const headers = [];
  for (let i = 0; i < cols; i++) headers.push(ref.headers[i] || ('第' + (i + 1) + '列'));

  const guess = {};
  const used = {};
  MAP_FIELDS.forEach(f => {
    const idx = headers.findIndex((h, i) => !used[i] && MAP_KW[f.k].test(h));
    if (idx >= 0) { guess[f.k] = idx; used[idx] = 1; }
  });
  ['id', 'qty'].forEach(k => {
    if (guess[k] != null) return;
    let best = -1, bestR = 0;
    for (let i = 0; i < cols; i++) {
      if (used[i]) continue;
      const r = k === 'id' ? colRatio(ref, i, false) : colRatio(ref, i, true);
      if (r > bestR) { bestR = r; best = i; }
    }
    if (best >= 0 && bestR >= (k === 'id' ? 0.6 : 0.5)) { guess[k] = best; used[best] = 1; }
  });

  MAP_FIELDS.forEach(f => {
    const sel = document.querySelector('#autoMap select[data-k="' + f.k + '"]');
    const optional = f.k !== 'id' && f.k !== 'qty';
    let opts = optional ? '<option value="-1">（不指定）</option>' : '';
    opts += headers.map((h, i) => '<option value="' + i + '">' + esc(h) + '</option>').join('');
    sel.innerHTML = opts;
    let v = prev[f.k];
    const invalid = v == null || v === '' || (v === '-1' && !optional) || Number(v) >= cols;
    if (invalid) {
      if (guess[f.k] != null) v = String(guess[f.k]);
      else v = optional ? '-1' : '0';
    }
    sel.value = v;
  });
}

function readAutoMap() {
  const m = {};
  document.querySelectorAll('#autoMap select').forEach(s => { m[s.dataset.k] = Number(s.value); });
  return m;
}

function analyze(table, map) {
  const recs = table.rows.map(r => ({
    id: map.id >= 0 ? String(r[map.id] || '').trim() : '',
    qty: map.qty >= 0 ? toNum(r[map.qty]) : null,
    project: map.project >= 0 ? String(r[map.project] || '').trim() : '',
    dept: map.dept >= 0 ? String(r[map.dept] || '').trim() : '',
    period: map.period >= 0 ? String(r[map.period] || '').trim() : ''
  }));
  const st = {
    rows: recs.length, recs, posRows: 0, posSum: 0, negRows: 0, negSum: 0,
    zero: 0, empty: 0, noId: 0, uniq: 0, dupIds: 0, dupRows: 0,
    ids: new Map(), totals: new Map(), groups: new Map()
  };
  recs.forEach(x => {
    if (!x.id) st.noId++;
    else st.ids.set(x.id, (st.ids.get(x.id) || 0) + 1);
    if (x.qty === null) st.empty++;
    else if (x.qty > 0) { st.posRows++; st.posSum += x.qty; }
    else if (x.qty < 0) { st.negRows++; st.negSum += x.qty; }
    else st.zero++;
    if (x.id) st.totals.set(x.id, (st.totals.get(x.id) || 0) + (x.qty || 0));
    const key = [x.project, x.dept, x.period].filter(Boolean).join(' / ') || '全部';
    const g = st.groups.get(key) || {rows: 0, sum: 0, pos: 0, neg: 0, zero: 0};
    g.rows++;
    if (x.qty !== null) {
      g.sum += x.qty;
      if (x.qty > 0) g.pos += x.qty;
      else if (x.qty < 0) g.neg += x.qty;
      else g.zero++;
    }
    st.groups.set(key, g);
  });
  st.uniq = st.ids.size;
  st.ids.forEach(n => { if (n > 1) { st.dupIds++; st.dupRows += n - 1; } });
  return st;
}

function compareStats(s1, s2) {
  const missing = [], extra = [], mismatch = [];
  s1.totals.forEach((v, id) => {
    if (!s2.totals.has(id)) missing.push({id, qty: v});
    else {
      const w = s2.totals.get(id);
      if (Math.abs(round2(v - w)) > 0.005) mismatch.push({id, src: v, sys: w, diff: round2(w - v)});
    }
  });
  s2.totals.forEach((v, id) => { if (!s1.totals.has(id)) extra.push({id, qty: v}); });
  return {missing, extra, mismatch};
}
function anomTable(title, rows, cols, vals) {
  if (!rows.length) return '';
  const show = rows.slice(0, 20);
  return '<div class="res-title">' + title + '（' + rows.length + ' 条' +
    (rows.length > 20 ? '，仅显示前 20 条' : '') + '）</div>' +
    '<table class="res"><thead><tr>' + cols.map(c => '<th>' + c + '</th>').join('') + '</tr></thead><tbody>' +
    show.map(r => '<tr>' + vals.map(v => '<td class="num">' + esc(v(r)) + '</td>').join('') + '</tr>').join('') +
    '</tbody></table>';
}

function renderAutoResult() {
  if (!autoResult) return;
  const s1 = autoResult.src, s2 = autoResult.sys, cmp = autoResult.cmp;
  const el = document.getElementById('autoRes');
  let cards, rows = '';

  if (cmp) {
    cards = [
      {l: '漏抓（源有系统无）', v: cmp.missing.length, alert: cmp.missing.length > 0},
      {l: '多抓（系统有源无）', v: cmp.extra.length, alert: cmp.extra.length > 0},
      {l: '重复单号（系统）', v: s2.dupIds, alert: s2.dupIds > 0},
      {l: '数量不一致', v: cmp.mismatch.length, alert: cmp.mismatch.length > 0}
    ];
    rows =
      '<div class="res-title">逐条比对结果</div>' +
      '<table class="res"><thead><tr><th>指标</th><th class="num">源系统</th><th class="num">系统内</th><th class="num">差异</th></tr></thead><tbody>' +
      '<tr><td>行数</td><td class="num">' + s1.rows + '</td><td class="num">' + s2.rows + '</td><td class="num">' + (s2.rows - s1.rows > 0 ? '+' : '') + (s2.rows - s1.rows) + '</td></tr>' +
      '<tr><td>去重单号数</td><td class="num">' + s1.uniq + '</td><td class="num">' + s2.uniq + '</td><td class="num">' + (s2.uniq - s1.uniq > 0 ? '+' : '') + (s2.uniq - s1.uniq) + '</td></tr>' +
      '<tr><td>正数行数 / 合计</td><td class="num">' + s1.posRows + ' / ' + fmtNum(s1.posSum) + '</td><td class="num">' + s2.posRows + ' / ' + fmtNum(s2.posSum) + '</td><td class="num">' + fmtNum(s2.posSum - s1.posSum) + '</td></tr>' +
      '<tr><td>负数行数 / 合计</td><td class="num">' + s1.negRows + ' / ' + fmtNum(s1.negSum) + '</td><td class="num">' + s2.negRows + ' / ' + fmtNum(s2.negSum) + '</td><td class="num">' + fmtNum(s2.negSum - s1.negSum) + '</td></tr>' +
      '<tr><td>零值行数</td><td class="num">' + s1.zero + '</td><td class="num">' + s2.zero + '</td><td class="num">' + (s2.zero - s1.zero > 0 ? '+' : '') + (s2.zero - s1.zero) + '</td></tr>' +
      '<tr><td>空值行数</td><td class="num">' + s1.empty + '</td><td class="num">' + s2.empty + '</td><td class="num">' + (s2.empty - s1.empty > 0 ? '+' : '') + (s2.empty - s1.empty) + '</td></tr>' +
      '<tr><td>无单号行数</td><td class="num">' + s1.noId + '</td><td class="num">' + s2.noId + '</td><td class="num">—</td></tr>' +
      '</tbody></table>';
  } else {
    const one = s2.rows ? s2 : s1;
    cards = [
      {l: '明细行数', v: one.rows},
      {l: '去重单号数', v: one.uniq},
      {l: '重复单号', v: one.dupIds, alert: one.dupIds > 0},
      {l: '空值行数', v: one.empty, alert: one.empty > 0}
    ];
    rows = '<div class="anom-note">只提供了一份数据，已做单份统计；两份都粘贴后才能逐条比对漏抓、多抓与数量差异。</div>';
  }

  el.innerHTML =
    '<div class="res-cards">' + cards.map(c =>
      '<div class="res-card' + (c.alert ? ' alert' : '') + '"><b>' + c.v + '</b><span>' + c.l + '</span></div>'
    ).join('') + '</div>' + rows;

  // 按项目 / 部门 / 期间
  const keys = Array.from(new Set(Array.from(s1.groups.keys()).concat(Array.from(s2.groups.keys()))));
  if (keys.length > 1 || (keys.length === 1 && keys[0] !== '全部')) {
    el.innerHTML += '<div class="res-title">按项目 / 部门 / 期间</div>' +
      '<table class="res"><thead><tr><th>分组</th><th class="num">源行数</th><th class="num">源合计</th>' +
      '<th class="num">系统行数</th><th class="num">系统合计</th><th class="num">合计差异</th></tr></thead><tbody>' +
      keys.map(k => {
        const a = s1.groups.get(k) || {rows: 0, sum: 0};
        const b = s2.groups.get(k) || {rows: 0, sum: 0};
        return '<tr><td>' + esc(k) + '</td><td class="num">' + a.rows + '</td><td class="num">' + fmtNum(a.sum) +
          '</td><td class="num">' + b.rows + '</td><td class="num">' + fmtNum(b.sum) + '</td><td class="num">' + fmtNum(b.sum - a.sum) + '</td></tr>';
      }).join('') + '</tbody></table>';
  }

  if (!cmp) return;

  el.innerHTML +=
    anomTable('漏抓明细（源系统有、系统内没有）', cmp.missing, ['单据号', '源系统数量'], [r => r.id, r => fmtNum(r.qty)]) +
    anomTable('多抓明细（系统内有、源系统没有）', cmp.extra, ['单据号', '系统数量'], [r => r.id, r => fmtNum(r.qty)]) +
    anomTable('数量不一致', cmp.mismatch, ['单据号', '源系统', '系统内', '差异'],
      [r => r.id, r => fmtNum(r.src), r => fmtNum(r.sys), r => (r.diff > 0 ? '+' : '') + fmtNum(r.diff)]);

  const dupRows = [];
  s2.ids.forEach((n, id) => { if (n > 1) dupRows.push({id, n}); });
  el.innerHTML += anomTable('系统内重复单号', dupRows, ['单据号', '出现次数'], [r => r.id, r => r.n]);
}

function runAutoCheck() {
  const errEl = document.getElementById('autoErr');
  errEl.textContent = '';
  const srcText = document.getElementById('autoSrc').value;
  const sysText = document.getElementById('autoSys').value;
  if (!srcText.trim() && !sysText.trim()) { errEl.textContent = '请至少粘贴一份明细数据'; return; }
  const src = parseTable(srcText);
  const sys = parseTable(sysText);
  const map = readAutoMap();
  if (map.id < 0 || map.qty < 0) { errEl.textContent = '请先选择单据号列和数量列'; return; }
  const need = Math.max(map.id, map.qty);
  if (src.rows.length && src.cols <= need) { errEl.textContent = '源系统数据缺少所选列，请检查列对应关系'; return; }
  if (sys.rows.length && sys.cols <= need) { errEl.textContent = '系统内数据缺少所选列，请检查列对应关系'; return; }

  const s1 = analyze(src, map);
  const s2 = analyze(sys, map);
  const both = s1.rows > 0 && s2.rows > 0;
  autoResult = {src: s1, sys: s2, cmp: both ? compareStats(s1, s2) : null, at: new Date()};
  renderAutoResult();
}

function autoNote() {
  const s1 = autoResult.src, s2 = autoResult.sys, cmp = autoResult.cmp, d = autoResult.at;
  const t = d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + ' ' +
    pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  let s = '自动核对 ' + t + '：源 ' + s1.rows + ' 行 / 系统 ' + s2.rows + ' 行' +
    '；正数合计 ' + fmtNum(s2.posSum) + '，负数合计 ' + fmtNum(s2.negSum) +
    '，零值 ' + s2.zero + ' 行，空值 ' + s2.empty + ' 行';
  if (cmp) {
    s += '；漏抓 ' + cmp.missing.length + '，多抓 ' + cmp.extra.length +
      '，重复单号 ' + s2.dupIds + '，数量不一致 ' + cmp.mismatch.length;
  } else {
    s += '；仅单份数据，未做逐条比对';
  }
  return s;
}

function renderAutoTarget() {
  const sel = document.getElementById('autoTarget');
  const dataItems = state.items.filter(i => i.category === 'data');
  sel.innerHTML = '<option value="new">（新建一条数据核对项）</option>' +
    dataItems.map(i => '<option value="' + i.id + '">更新：' + esc(i.title) + '</option>').join('');
}

function writeAutoResult() {
  const errEl = document.getElementById('autoErr');
  if (!autoResult) { errEl.textContent = '请先点击“开始核对”'; return; }
  const sel = document.getElementById('autoTarget');
  const s2 = autoResult.sys.rows ? autoResult.sys : autoResult.src;
  let it;
  if (sel.value === 'new') {
    it = mk('data', '明细自动核对 ' + stamp(), {});
    state.items.push(it);
  } else {
    it = state.items.find(i => i.id === sel.value);
  }
  if (!it) { errEl.textContent = '未找到目标检查项'; return; }

  it.detailCount = String(s2.rows);
  it.posSum = String(round2(s2.posSum));
  it.negSum = String(round2(s2.negSum));
  it.zeroCount = String(s2.zero);
  ['project', 'dept', 'period'].forEach(k => {
    const set = Array.from(new Set(s2.recs.map(x => x[k]).filter(Boolean)));
    if (set.length === 1) it[k] = set[0];
  });
  it.note = autoNote();
  it.updatedAt = Date.now();
  save();
  closeAuto();
  renderAll();
  toast(sel.value === 'new' ? '已新建数据核对项并写入结果' : '核对结果已写入检查项');
}

function openAuto() {
  autoResult = null;
  document.getElementById('autoRes').innerHTML = '';
  document.getElementById('autoErr').textContent = '';
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

    if (act === 'add') { e.preventDefault(); openModal(null, el.dataset.cat); }
    else if (act === 'edit') { if (id) openModal(id); }
    else if (act === 'quickPass') {
      const it = state.items.find(i => i.id === id);
      if (!it) return;
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
    clearTimeout(autoTimer);
    autoTimer = setTimeout(refreshAutoMap, 250);
  };
  document.getElementById('autoSrc').addEventListener('input', scheduleAuto);
  document.getElementById('autoSys').addEventListener('input', scheduleAuto);
  document.getElementById('autoHeader').addEventListener('change', () => {
    refreshAutoMap();
    document.getElementById('autoRes').innerHTML = '';
    document.getElementById('autoErr').textContent = '';
    autoResult = null;
  });

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
  if (stored && stored.length) {
    state.items = stored.map(normalizeItem);
    document.getElementById('savedTip').textContent = '本地数据已载入';
  } else {
    state.items = seedItems();
    save();
  }
  bindEvents();
  renderAll();
})();
