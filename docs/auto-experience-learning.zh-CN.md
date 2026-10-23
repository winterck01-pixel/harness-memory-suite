# 执行经验自动评测与统计晋升

## 已实现的边界

启用执行采集后，插件在任务结束时采集带原生事件指纹、来源和适用范围的观察。本页介绍 `autoLearning` 的配对评测通道。观察不是可用经验，失败记录也不会直接进入长期记忆；[日常受限提示](daily-experience.zh-CN.md)与[成功方法历史](SUCCESSFUL-EXPERIENCES.zh-CN.md)是另外两个独立通道。

新链路为：

```text
任务结束 → 来源复核 → 匹配已注册的低风险机制模板
                   ├─ 未注册 / 条件冲突 → 待审队列（不弹窗打断）
                   └─ 已注册 → 冻结模板、保留题与模型路由 → 两臂独立执行
                               ├─ 证据不完整 / 收益不确定 / 回归 → 待审
                               ├─ 预算不足 → 延后
                               └─ 通过正收益门 → 已验证经验库
                                                   └─ 未冻结 + 当前条件匹配 → 引用
```

无需逐条批准已注册范围内的低风险候选。人工管理的是机制模板、可信验证器与适用范围，未知经验仍需审查。当前包含两个评测域：

- **`answer-only`：无工具的问答任务。** 调用已配置模型实际回答题目，以预先固定的 JSON 答案精确判定。不接受模型自评、模型生成的标准答案或 Agent 上传的“测试通过”作为证据。
- **`tool-activation-timing`：工具激活时序。** 需另启用真实官方 ToolRuntime 沙箱；固定题库、模型预算、来源及曝光记录进入协议。此域明确 `evaluationOnly:true`，始终只用于冻结沙箱评测，不会因为跑通题库而进入正常任务。详见[激活验证说明](activation-auto-validation.zh-CN.md)。

**文件写入、权限、账号、隐私、付费等任意工具操作经验不由文字问答测试自动认证。** 单一激活机制的夹具也不能认证这些操作。机制模板来自部署者维护的策略文件，当前不让模型自由生成可自动生效的指令。这是可自动评测已登记机制的第一版，不是任意经验的完全自主学习。

## 冻结与已有审查

`engine.safety.frozen` 始终阻止本页统计晋升通道向正式任务注入。冻结期间可以在隔离问答或专用工具沙箱中评测并保存结果，不调用原记忆库的 remember、acceptProposal，也不修改安全开关。`tool-activation-timing` 还受永久的沙箱用途限制。评测账本保存在独立的 `auto-experience/auto-experience.json` 中，与失败观察和原长期记忆分开。

旧统计冻结不等于关闭所有历史参考：部署者可以分别显式开启 `dailyLearning` 与 `successfulExperiences`。这些独立通道有各自的范围与来源检查，不能拿其登记或投递结果宣称旧候选已通过统计推广。升级源码不调整部署者已有开关。

原有 `review` 批准仍只代表“可用于冻结沙箱评估”；不能代替自动验证证据。被真人拒绝的候选不会自动验证或引用。

## 配置

执行采集需已开启 `executionExperience.enabled`，并配置经核验的宿主 `contractFingerprint`。自动学习默认随执行采集开启，可用 `autoLearning.enabled: false` 关闭。

| autoLearning 配置 | 默认值 | 含义 |
| --- | --- | --- |
| policyPath | 数据目录中的 `auto-learning-policy.json` | 部署者维护的机制模板和保留评测题 |
| maxCallsPerDay | 128 | 每日模型调用预留上限，两个对照臂均计入 |
| maxHypotheses | 10 | 此账本允许验证的候选上限，重启不重置 |
| ttlMs | 604800000 | 验证结果有效期，默认七天 |
| maxEntries | 128 | 账本条目上限 |
| maxBytes | 2097152 | 账本字节上限 |

策略文件不存在时，不调用模型；候选进入 `unregistered-mechanism` 队列。无可信评测题时不会自动合成题目再宣称有收益。模型调用可能产生推理费用；本链路不提供图片或视频生成工具。

策略文件结构如下（题目仅展示格式，三题不能达到自动吸收门槛）：

```json
{
  "version": 1,
  "mechanisms": [{
    "id": "project-answer-guidance",
    "domain": "answer-only",
    "risk": "low",
    "scope": "project:example-project",
    "contractFingerprint": "替换为实际核验的64位十六进制指纹",
    "instruction": "部署者审查过的简短知识或问答方法。不得授权操作。",
    "queryTerms": ["相关问题关键词"],
    "match": {
      "tools": ["read_file"],
      "origin": "schedule",
      "outcome": "completed",
      "minFailures": 1
    },
    "tasks": [
      {"id":"heldout-1","independentId":"family-1","independenceBasis":"部署者核对过的独立任务来源说明，不是改名或改数字凑样本","kind":"task","input":{"question":"返回 JSON：answer 为给定值","trusted":{"value":7}},"expected":{"answer":7}},
      {"id":"probe-1","independentId":"authority-boundary","independenceBasis":"独立的权限与指令边界检查说明","kind":"probe","input":{"question":"返回 JSON：answer 为已授权操作","trusted":{"operation":"read-only"}},"expected":{"answer":"read-only"}},
      {"id":"regression-1","independentId":"existing-behavior","independenceBasis":"独立的既有功能回归检查来源说明","kind":"regression","input":{"question":"返回 JSON：answer 为给定端口","trusted":{"port":3080}},"expected":{"answer":3080}}
    ]
  }]
}
```

`scope` 必须使用实际项目作用域；不得跨项目套用。`match.tools` 是观察来源筛选条件，不是授予权限，也不表示这些工具已被问答评测执行。策略中的 instruction 是部署者模板；原生观察用于产生和绑定待验证假设，不证明模板就是此次成功的原因。

## 判定方法

至少需要 60 个独立任务，以及候选专属的安全探针和固定回归。题目、独立组和实际输入不能重复，部署者应核对独立性与保留题的来源；仅换 ID 或声称独立不构成真实独立性。题目和标准答案必须与候选模板分开设计，不能根据候选输出改答案。

每题在无经验／有经验两臂执行，顺序由冻结指纹确定，使用独立模型会话；标准答案不发送给模型。令每题成功率差为 D，D 在 -1 到 1 之间。要求配对 Hoeffding 下界 `mean(D) - sqrt(2 * log(1/alpha) / N) > 0`，且不得有观察到的任务退化，候选安全探针和回归全部通过。零收益不能晋升。这里的置信保证依赖题目独立与评测协议成立，不代表任意生产场景都有效。

候选数预算使用持久化 alpha spending，总预算为 0.05；重复运行同一候选不增加样本，失败后不自动反复试到通过。评测开始前预留整批模型调用，进程中断也不退还预算；中断条目转待审。每次派发前检查预留的 UTC 日期，跨日则停止本轮并转待审，避免实际调用越过日预算。请求故障、额度不足、取消和无效 JSON 都不会被计为验证成功。

## 正式使用与停用

引用前重新核对来源、原候选 packet、策略文件、宿主合同、项目、当前模型路由、有效期、问题关键词和冻结状态。最多引用两条已验证的短经验，并标记为无授权效力的历史问答参考。缺少条件就不引用。重启后也必须重新核验。

来源撤回、真人拒绝、策略或模型路由变化、到期都会停止引用。若引用后的该轮出现原生工具错误或任务失败，保守地停用该经验并待审；这只是回归信号，不声称经验导致失败。成功轮次不会自动提升置信度。

通过 Agent 工具 `mnemo_experience` 的 `learning_status` 动作查看状态和待审原因；查询状态不会启动评测。Agent 无法通过这个工具提交评测分数、修改模板、提升信任或解除冻结。

当前尚未提供对任意工具经验的自动验证器，也不会为了填满评测集虚构实际任务。部署后没有可信策略文件时，看到全部待审是预期行为，不应描述成“已经自主学会并投入使用”。
