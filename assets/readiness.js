(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Readiness = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function text(value) {
    return value == null ? '' : String(value).trim();
  }

  function hasBasis(value) {
    const basis = text(value);
    return !!basis && !/^(?:(?:待|请)(?:填写|补充|确认|完善)|未(?:填写|确认)|TODO\b|TBD\b)/i.test(basis);
  }

  function isExempt(item) {
    return item.status === '不适用' && !!text(item.naReason);
  }

  function blockingReasons(item) {
    const it = item || {};
    const reasons = [];
    if (it.status === '不适用') {
      return isExempt(it) ? reasons : ['不适用项须填写不适用理由'];
    }

    if (it.critical && it.status !== '通过') reasons.push('关键检查项尚未通过');

    if (it.category === 'issue' && it.severity === '严重') {
      if (it.status !== '通过') reasons.push('严重缺陷尚未关闭');
      if (it.retest !== '通过') reasons.push('严重缺陷尚未复测通过');
      if (it.history !== '已处理' && it.history !== '不涉及') reasons.push('严重缺陷的历史错数处理尚未确认');
      if (!text(it.impact) || text(it.impact) === '待评估') reasons.push('严重缺陷的关联功能影响尚未评估');
    }

    if (it.critical && it.status === '通过') {
      if (it.category === 'rule') {
        if (!text(it.confirmOwner)) reasons.push('关键业务规则缺少业务确认人');
        if (!hasBasis(it.basis)) reasons.push('关键业务规则缺少有效确认依据');
      }
      if (it.category === 'test' && !text(it.actual)) reasons.push('核心测试缺少实际结果');
      if (['rule', 'test', 'data', 'launch'].indexOf(it.category) !== -1 && !text(it.evidence)) {
        reasons.push('关键检查项缺少验收证据');
      }
      if (it.category === 'data' && it.reconciliation) {
        if (Number(it.reconciliation.issues) > 0) reasons.push('关键数据核对仍存在未解决差异或异常');
        if (it.reconciliation.both === false) reasons.push('关键数据核对仅有单份数据，尚未完成双向比对');
      }
    }
    return reasons;
  }

  function evaluate(items) {
    const list = Array.isArray(items) ? items : [];
    const reasons = Object.create(null);
    const entries = list.map(function (item, index) {
      const itemReasons = blockingReasons(item);
      reasons[item.id || 'item-' + index] = itemReasons;
      return {item: item, reasons: itemReasons};
    });
    const blockers = entries.filter(function (entry) { return entry.reasons.length > 0; }).map(function (entry) { return entry.item; });
    const total = list.length;
    const na = list.filter(isExempt).length;
    const applicable = total - na;
    const pass = entries.filter(function (entry) { return entry.item.status === '通过' && !entry.reasons.length; }).length;
    const open = applicable - pass;
    const severe = entries.filter(function (entry) {
      return entry.item.category === 'issue' && entry.item.severity === '严重' && entry.reasons.length > 0;
    }).length;
    const rate = applicable > 0 ? Math.round(pass / applicable * 100) : 0;
    let reviewState, reviewMessage;
    if (!total || !applicable) {
      reviewState = 'insufficient';
      reviewMessage = !total ? '尚未建立检查台账，无法判断上线准备情况。' : '全部检查项均不适用，缺少有效检查记录，请补充本次上线的检查项。';
    } else if (blockers.length) {
      reviewState = 'blocked';
      reviewMessage = '存在 ' + blockers.length + ' 项阻断，请补齐验证与闭环记录后再评审。';
    } else if (open || list.some(function (item) { return !!item.example; })) {
      reviewState = 'pending';
      reviewMessage = '仍有未完成检查项或示例数据，请完成真实验收后再评审。';
    } else {
      reviewState = 'review';
      reviewMessage = '检查记录已完成，待业务负责人进行人工上线评审。';
    }
    return {blockers: blockers, reasons: reasons, total: total, pass: pass, na: na, open: open, severe: severe,
      applicable: applicable, rate: rate, reviewState: reviewState, reviewMessage: reviewMessage};
  }

  return {blockingReasons: blockingReasons, evaluate: evaluate};
});
