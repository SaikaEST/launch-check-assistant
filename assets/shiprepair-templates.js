'use strict';

/* Suggested checklists only. Applying a template does not confirm a rule or pass a test. */
(function () {
  function check(templateKey, category, title, critical, fields) {
    return Object.assign({
      templateKey: templateKey,
      category: category,
      title: title,
      critical: critical,
      priority: critical ? '高' : '中',
      status: '待处理',
      owner: '',
      due: '',
      confirmOwner: '',
      bizOwner: '',
      basis: '待填写本项目确认依据',
      note: '建议核对项，适用范围须由现场确认；填写本项目口径和验证证据后再评定状态。',
      steps: '',
      expected: '',
      actual: '',
      evidence: '',
      naReason: '',
      project: '',
      dept: '',
      period: '',
      detailCount: '',
      summaryCount: '',
      posSum: '',
      negSum: '',
      zeroCount: '',
      version: '',
      rollback: '',
      postCheck: '',
      example: false
    }, fields || {});
  }

  window.SHIPREPAIR_TEMPLATES = [
    {
      id: 'company-settlement',
      templateKey: 'company-settlement',
      name: '公司结算',
      description: '核对工程签单来源、结算阶段、金额显示时点和明细汇总口径。全部检查项初始为待处理。',
      items: [
        check('company-settlement-source-scope', 'rule', '确认公司结算来源范围与同步阶段', true, {
          note: '建议核对项，适用范围须由现场确认：记录工程、专业、施工单位、二级项目、签单状态及来源版本；明确预结与完工阶段分别取什么数据。',
          expected: '形成已确认的来源范围、状态条件、关联键和同步触发时点；不按页面名称推定自动同步规则。'
        }),
        check('company-settlement-display-nodes', 'rule', '确认流程内外金额的显示节点及空值含义', true, {
          note: '建议核对项，适用范围须由现场确认：分别记录流程详情和外部列表在哪个节点后显示金额；核对日志第二步、调整金额节点是否适用本项目，区分未到节点、空值与真实零值。',
          expected: '每个金额字段有明确页面、显示节点、计算或抓取时点及未显示原因；不把未显示直接计为零。'
        }),
        check('company-settlement-signature-gate', 'test', '验证专业签单及结算信息完整性检查', true, {
          steps: '1. 在获准测试环境准备虚构工程 DEMO-SHIP-001。\n2. 分别覆盖全部签单、部分二级项目未签单、缺少专业或施工单位。\n3. 按已确认规则验证提交结果并保存提示与状态证据。',
          expected: '允许或阻止提交的结果符合本项目已确认条件，提示能定位具体二级项目、专业或缺失字段。'
        }),
        check('company-settlement-display-test', 'test', '验证金额显示节点前后及零值场景', true, {
          steps: '1. 在获准测试环境记录同一测试流程的当前节点。\n2. 比对金额显示节点前后，流程详情与外部列表的金额和日志。\n3. 覆盖真实零值、尚未生成及已调整金额场景，记录差异。',
          expected: '显示结果与已确认节点和金额口径一致；未显示、零值和已调整金额可区分，流程日志能解释显示时点。'
        }),
        check('company-settlement-sync-retry', 'test', '验证同步重试和来源变更不会重复计入', true, {
          steps: '1. 按已确认条件执行测试同步并留存来源清单。\n2. 覆盖重复执行、失败重试及来源内容变更。\n3. 按工程、专业、项目、明细行及版本核对目标记录。',
          expected: '最终记录符合已确认的更新与去重规则；无漏行、重复计入或跨工程、跨专业串入。'
        }),
        check('company-settlement-detail-scope', 'data', '同范围核对签单来源与结算明细', true, {
          note: '建议核对项，适用范围须由现场确认：先固定工程、专业、施工单位、二级项目、来源版本和状态，再用稳定明细键核对条数及字段；在证据中记录漏项、增项、重复和差异原因。',
          expected: '来源与结算明细可逐行追溯，汇总范围一致，所有差异均有处理结论。'
        }),
        check('company-settlement-amount-total', 'data', '核对金额、调整与合计的口径和精度', true, {
          note: '建议核对项，适用范围须由现场确认：分别核对公司结算金额、调整金额、合计的定义、币种、正负方向、小数精度和汇总来源；未经确认不预置三者计算公式。',
          expected: '使用本项目确认的公式与精度复算；正数、负数、零值和空值均有依据，明细与汇总差异已闭环。'
        }),
        check('company-settlement-release-review', 'launch', '完成公司结算版本验收与上线交接', true, {
          note: '建议核对项，适用范围须由现场确认：记录待发版本、配置、角色、已关闭问题和业务确认；同步与显示节点变更需覆盖关联页面。',
          rollback: '待填写本项目备份位置、恢复步骤、触发条件和执行负责人。',
          postCheck: '待确定上线后首批工程的来源明细、流程内外金额、同步日志与角色可见范围检查计划。',
          expected: '验收、备份恢复方案和上线后检查责任明确，业务上线意见与未结事项有记录。'
        })
      ]
    },
    {
      id: 'workshop-monthly-settlement',
      templateKey: 'workshop-monthly-settlement',
      name: '车间分配与月度结算',
      description: '核对专业跨流程汇总、分配调整、期间和流程衔接，避免用当前详情小计代替全范围汇总。',
      items: [
        check('workshop-monthly-related-flow-scope', 'rule', '确认专业调整金额的相关流程集合', true, {
          note: '建议核对项，适用范围须由现场确认：专业汇总是否取所有相关流程的分配调整金额？逐项定义工程、专业、月份、流程状态、有效版本与排除条件，不擅自扩展跨工程或跨月范围。',
          expected: '可列出参与汇总的完整流程集合与筛选条件；当前单流程或当前详情小计的适用范围明确。'
        }),
        check('workshop-monthly-amount-definitions', 'rule', '确认分配金额、调整金额与月度合计定义', true, {
          note: '建议核对项，适用范围须由现场确认：区分公司结算金额、分配调整金额、专业汇总调整金额和月度合计；记录协议、外包、计件等分类口径及正负方向，不因字段名称相近就共用公式。',
          expected: '各金额字段有确认人、来源、公式、期间、精度和分类说明，未确认公式不参与验收结论。'
        }),
        check('workshop-monthly-cross-flow-test', 'test', '验证跨流程专业汇总及无关流程排除', true, {
          steps: '1. 在获准测试环境准备虚构工程 DEMO-SHIP-002 的多条相关流程。\n2. 按确认范围设置同专业正调整、负调整、零值，并准备应排除的流程。\n3. 比对专业汇总、全部来源流程和当前详情小计。',
          expected: '汇总仅包含确认范围内的有效流程，每项调整只计一次；局部小计与跨流程汇总的区别可追溯。'
        }),
        check('workshop-monthly-handoff-test', 'test', '验证公司结算、车间分配与月度流程衔接', true, {
          steps: '1. 根据本项目确认的流程图核对各阶段角色和进入条件。\n2. 在获准测试环境覆盖未完成、完成、退回等已确认分支。\n3. 比对业务单据状态、可操作范围和流程日志。',
          expected: '各阶段状态与权限符合确认规则，能区分流程完成、通知财务、财务入账及实际付款。'
        }),
        check('workshop-monthly-version-period-test', 'test', '验证退回重提、历史版本及跨期处理', true, {
          steps: '1. 先确认退回、重提、作废及跨期调整规则。\n2. 在获准测试环境覆盖适用分支并记录流程与版本。\n3. 核对原期间、目标期间及专业汇总是否按规则更新。',
          expected: '有效版本和期间归属符合已确认规则，无历史版本重复计入；不适用分支记录理由。'
        }),
        check('workshop-monthly-flow-total-data', 'data', '按完整来源清单复核专业调整金额', true, {
          note: '建议核对项，适用范围须由现场确认：在证据中列出相关流程标识、专业、期间、有效状态与分配调整金额；按同一集合复算专业汇总，禁止只用当前详情小计作全量校验。',
          expected: '来源流程集合完整、无重复，逐流程金额与专业汇总能对上；缺失来源时保留待处理状态。'
        }),
        check('workshop-monthly-classification-data', 'data', '核对分类明细、施工单位及期间归属', true, {
          note: '建议核对项，适用范围须由现场确认：核对协议、外包、计件等适用分类，检查施工单位、专业、工程和期间；先确认分类是否互斥及合计公式，再对比分类明细与汇总。',
          expected: '分类、维度与期间一致，未分类和重复分类均有解释，金额差异按确认公式处理。'
        }),
        check('workshop-monthly-release-review', 'launch', '完成分配与月度结算上线评审', true, {
          note: '建议核对项，适用范围须由现场确认：确认待发版本、汇总范围、期间配置、适用角色和历史差异处理结论，并留存业务验收。',
          rollback: '待填写流程与历史数据备份、恢复边界、回滚步骤和执行负责人。',
          postCheck: '待确定首个结算期间的完整流程集合、专业调整汇总、分类明细及跨期异常检查计划。',
          expected: '上线窗口、未结事项与处置责任明确，汇总范围及期间口径已完成业务验收。'
        })
      ]
    },
    {
      id: 'engineering-signoff',
      templateKey: 'engineering-signoff',
      name: '工程签单',
      description: '核对工程项目层级、内容与物量、专业及数据行权限，并验证提交签单状态。',
      items: [
        check('engineering-signoff-project-identity', 'rule', '确认整船工程、二级项目及明细行标识', true, {
          note: '建议核对项，适用范围须由现场确认：区分整船工程编号、二级项目编号、内容行和物量行，记录来源与目标关联键；同名“项目编号”不得直接视为同一对象。',
          expected: '项目层级、内容与物量对应关系清晰，可稳定定位同一工程中的每个签单对象。'
        }),
        check('engineering-signoff-role-scope', 'rule', '确认专业、行归属及授权范围', true, {
          note: '建议核对项，适用范围须由现场确认：分别定义总管、主管及其他适用角色的查看和操作权限，明确部门范围、个人数据行归属、转授与专业授权的区别及有效期。',
          expected: '形成适用本项目的权限矩阵，不以页面可见或按钮存在作为拥有编辑或签单权限的依据。'
        }),
        check('engineering-signoff-state-test', 'test', '验证写单、提交与签单的状态转换', true, {
          steps: '1. 在获准测试环境准备虚构工程 DEMO-SHIP-003 的工程内容和关联物量。\n2. 按确认规则覆盖草稿、提交、签单及适用退回分支。\n3. 核对状态文字、签单人、时间、日志与颜色显示。',
          expected: '状态转换与签单对象范围符合确认规则；颜色与状态文字一致，已签单不被表述为已结算或已付款。'
        }),
        check('engineering-signoff-authorization-test', 'test', '验证跨专业和他人数据行的操作限制', true, {
          steps: '1. 在获准测试环境使用已批准的不同角色测试账号。\n2. 覆盖本专业本人行、他人行、跨专业行及有效授权场景。\n3. 按权限矩阵核对查看、编辑、提交与签单结果。',
          expected: '授权范围符合确认规则，禁止操作有明确提示；失效授权不能继续使用，不出现越权或无关数据暴露。'
        }),
        check('engineering-signoff-template-test', 'test', '验证施工模板与物量录入后的关联', true, {
          steps: '1. 确认本项目适用的施工模板与物量单位。\n2. 在获准测试环境录入或调用模板，覆盖多内容行、多物量行及小数边界。\n3. 核对项目层级、专业、内容物量对应关系和签单结果。',
          expected: '模板使用结果符合确认配置，内容与物量关联保持正确；不把物量行误当独立报价项。'
        }),
        check('engineering-signoff-source-data', 'data', '核对签单记录与下游同步来源', true, {
          note: '建议核对项，适用范围须由现场确认：固定工程、专业、二级项目、签单状态与版本，按内容及明细行核对签单人与时间、施工单位及下游记录，记录漏项和重复项。',
          expected: '下游来源符合确认签单范围，签单记录与内容物量能追溯，无重复或跨工程串入。'
        }),
        check('engineering-signoff-quantity-data', 'data', '核对工程物量单位、精度与边界值', true, {
          note: '建议核对项，适用范围须由现场确认：按物量类型核对单位、数量、小数精度及零值、空值、负值的适用性；工程物量与物资需求中的同名字段分别确认换算规则。',
          expected: '工程物量与已确认类型和单位一致，边界值有处理依据，不套用未经确认的物资换算公式。'
        }),
        check('engineering-signoff-release-review', 'launch', '完成工程签单角色与数据验收', true, {
          note: '建议核对项，适用范围须由现场确认：记录待发版本、模板及权限配置，复核提交签单分支和下游影响，并明确业务确认人。',
          rollback: '待填写工程单、模板与授权配置备份范围、恢复步骤和执行负责人。',
          postCheck: '待确定首批工程的项目层级、签单状态、授权范围和下游同步抽查计划。',
          expected: '角色、状态与数据验收证据完整，业务上线意见和未结事项有记录。'
        })
      ]
    },
    {
      id: 'material-issue-procurement',
      templateKey: 'material-issue-procurement',
      name: '物资领采',
      description: '核对库存分流、物料编码、计量单位、异常审批及成本回写，保持需求与领采链路可追溯。',
      items: [
        check('material-issue-procurement-stock-rule', 'rule', '确认可用库存及领料采购分流口径', true, {
          note: '建议核对项，适用范围须由现场确认：明确采用账面、可用或扣除预留后的库存；定义库存满足、不足、部分满足时的领料与采购范围，以及占用、释放和数量分配规则。',
          expected: '同一需求的领料和采购分支有明确关联与数量口径，不将每张需求单都视为必须采购。'
        }),
        check('material-issue-procurement-unit-rule', 'rule', '确认需求数量、计价数量与成本价格来源', true, {
          note: '建议核对项，适用范围须由现场确认：分别记录需求与计价单位、规格、换算依据、公差和取整；明确采购价格与财务记账价格的用途、回写时点和币税口径。',
          expected: '单位与价格来源可追溯，不使用固定示例换算率，不把采购下单价格直接当作最终物料成本。'
        }),
        check('material-issue-procurement-branch-test', 'test', '验证库存全满足、部分满足与不足分支', true, {
          steps: '1. 在获准测试环境准备虚构工程 DEMO-SHIP-004 的物资需求。\n2. 按确认库存口径覆盖全满足、部分满足和无库存。\n3. 核对领料、采购、占用及剩余需求的关联和数量。',
          expected: '分流结果符合确认规则，同一需求不被双重满足或遗漏；所有数量比较采用同一单位和口径。'
        }),
        check('material-issue-procurement-code-test', 'test', '验证物料名称、别名与无编码核料', true, {
          steps: '1. 确认现有编码、别名匹配和无编码核料规则。\n2. 在获准测试环境覆盖标准名称、别名、同名不同规格及无编码需求。\n3. 记录匹配结果、核料流向及审批证据。',
          expected: '名称和规格匹配符合确认规则，无编码需求可追溯至核料；别名不被无依据地当作新物料自动建码。'
        }),
        check('material-issue-procurement-exception-test', 'test', '验证超量、代用和采购放量的适用分支', true, {
          steps: '1. 由现场确认超量出库、物料代用、采购放量及组合场景的条件和审批顺序。\n2. 在获准测试环境覆盖适用分支。\n3. 核对审批、需求量、实发量及库存影响，保存日志。',
          expected: '各异常分支符合已确认规则，组合场景无漏审；库存回写方向和时点有依据，未确认组合保持待处理。'
        }),
        check('material-issue-procurement-chain-data', 'data', '核对需求、领料与采购的数量链路', true, {
          note: '建议核对项，适用范围须由现场确认：按工程、需求明细键、物料编码和规格关联领料采购记录，核对单位、状态、有效版本及适用退回或撤回记录，列出未满足和重复满足的需求。',
          expected: '每条需求的领采去向和剩余数量可解释，未混用不同单位或将无效单据重复计入。'
        }),
        check('material-issue-procurement-cost-data', 'data', '核对财务价格回写及单船物料成本', true, {
          note: '建议核对项，适用范围须由现场确认：核对财务记账价格、出库记录、工程归属、币税口径与接口时点；区分待回写、失败、真实零值和已入账，物料成本不代替整船全部成本。',
          expected: '价格来源与有效出库记录能追溯至同一工程；回写失败和重复处理有结论，不将未回写默认计零。'
        }),
        check('material-issue-procurement-release-review', 'launch', '完成物资领采接口与异常处理交接', true, {
          note: '建议核对项，适用范围须由现场确认：记录待发版本、库存和单位配置、适用角色、接口监控与重试规则，确认异常审批和差异处理责任。',
          rollback: '待填写物资单据及接口配置备份范围、库存一致性核查、恢复步骤和执行负责人。',
          postCheck: '待确定首批需求的库存分流、异常审批、单据关联及财务价格回写检查计划。',
          expected: '接口、数据及异常分支验收有证据，业务上线意见和异常处置责任有记录。'
        })
      ]
    }
  ];
})();
