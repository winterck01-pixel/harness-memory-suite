# 条件化成功方法经验

成功经验保存的是“在什么条件下，用什么做法，怎样检查结果”的历史方法。它与普通事实记忆、失败观察候选、旧统计晋升分别存储。完成一次任务不自动证明方法普遍有效；来源核验也不能代替独立业务质量检查。

## 卡片结构与证据

|字段|内容|
|---|---|
|`title`|方法名称，4–160 字符|
|`cues`|检索线索数组，1–8 项，每项 2–80 字符|
|`conditions`|适用条件数组，1–8 项，每项 2–400 字符|
|`method`|步骤数组，1–8 项，每项 2–400 字符；也接受一个 2–400 字符的方法段落|
|`limits`|不适用情况、约束与尚未检查的部分，格式同 `conditions`|
|`evidence.actionSeqs`|当前轮真实业务动作的**结果事件**序号数组，1–8 个，不是调用序号|
|`evidence.checkSeq`|动作完成之后，另一次工具调用产生的检查结果序号|
|`evidence.expected`|检查输出中逐字复制的连续片段，16–1000 字符，不能只写 `ok`、`true` 或“成功”|
|`evidence.summary`|说明检查了什么产物、结果和限制，8–600 字符|

`title/cues/conditions/method/limits` 的 JSON 总长度不超过 2600 字符。不要保存账号、密钥、个人数据、业务路径或整段日志；内置敏感模式过滤只能辅助检查，不能保证识别所有隐私。

动作和检查必须是同一可信当前轮的真实工具证据，检查在动作之后开始。失败结果、记忆工具回执、纯工具激活和混入记忆调用的外层聚合结果不能作为业务证据。`expected` 与检查输出不一致时保留为待审，不能用模型解释替代原文。方法最终还要绑定执行候选、项目、来源事件和合同指纹，在轮次结束后复核。

## 安装与配置

先完成 [README 的安装步骤](../README.md#安装与部署)，使用同一 MNEMO 条目与数据目录，不创建第二个写者。配置生成器不会替你开启经验通道。下面是**部署者主动选择只启用成功方法**的示例，并非维护者机器配置或完整宿主配置：

```yaml
executionExperience:
  enabled: true
  contractFingerprint: "<部署者核对的64位小写SHA256>"
autoLearning:
  enabled: false
dailyLearning:
  enabled: false
successfulExperiences:
  enabled: true
  maxCards: 128
  ttlMs: 2592000000
```

合同摘要需绑定实际宿主、采集实现和执行政策，不能直接复制占位符。升级后按新版本核对，不通过改写旧账本给旧经验换身份。示例没有修改普通记忆配置或冻结状态。

- `executionExperience` 默认关闭；后续三个经验组件均依赖它。
- `successfulExperiences.enabled` 只有显式 `true` 才启用。`maxCards` 默认 128，允许 1–1024；`ttlMs` 默认 30 天，允许正整数且最多 90 天。
- `autoLearning` 在执行采集启用后，除非显式设为 `false`，会尝试构造自动评测器。可信策略匹配后可能产生模型调用费用；只需要成功方法时按示例关闭它。
- `dailyLearning` 需单独显式启用，详见[日常受限复用](daily-experience.zh-CN.md)。启用它不是解除旧统计冻结。

成功方法模块本身只使用 Node.js 内建和包内模块。持久化来源复核需要宿主的 `sessionQuery.observeSession()`、`sessionPersistence.stat()` 及观察租约释放契约，详见[宿主接口要求](INTEGRATION.md#经验通道的宿主契约)。没有这些服务时，准确的活跃会话仍可作为来源；已经冷却的来源不能假定有效。不会为了读取来源启动旧 Agent、恢复任务或打开新的记忆写者。

## Agent 操作顺序

以下为模型工具动作，不是终端命令。`context-policy` 已把 `mnemo_experience` 加入基础可见集，但仍受宿主实际注册、当前权限和本轮禁记约束。其他宿主组合仍须按自己的能力激活方式调用；不要因旧轮次曾经激活就假定本轮可用。

1. **先完成并检查任务。** 只有可迁移、已经核对的做法才值得记录。业务动作和检查各用独立的工具调用；使用 PTC 时分别放在独立 `run_code` 中，避免与记忆动作混合。
2. **获取证据。** 调用 `mnemo_experience({action: "recent_evidence"})`。返回的是当前轮可引用结果，不会搜索全盘历史，也不会自动判断业务质量。
3. **提交草稿。** 调用 `record_success`，把上述字段放在 `draft` 内，证据放在 `draft.evidence` 内。返回待处理状态不等于卡片已经可用；轮后完成来源核验后再通过 `success_status`、`inspect_success` 查看。证据不足保留待审，目前没有新增的一键人工晋升界面。
4. **检索与判断。** 新任务用 `recall_success` 并提供具体 `query`；返回后逐条核对适用条件和限制。自动组装使用用户原句的标题/关键词匹配，最多提供两张卡片、总计有界文本；不是通用语义检索。
5. **在行动前声明采用。** 调用 `use_success`，传入卡片 `id` 和文字 `conditionCheck`（8–1200 字符），逐条说明当前事实如何满足条件。声明后结束该 `run_code`，再执行实际业务动作；不能执行完后补记采用。
6. **关联后续结果。** 采用之后的动作与独立检查完成，再取 `recent_evidence`，调用 `outcome_success`，把结果引用放在顶层 `evidence`。轮后再次复核才计入检查完成。发现已采用方法不适用或失败，用 `fail_success` 和具体 `reason`（8–600 字符）暂停卡片；未采用的不适用卡片直接忽略。

查询示例：

```js
await tools.mnemo_experience({ action: "success_status" })
await tools.mnemo_experience({ action: "recall_success", query: "核对文档清单与交付文件的一致性" })
```

`recall_success` 会更新经验卡片的投递记录和召回计数，因此不是无状态只读操作；它不写入普通长期事实记忆。

不提供可直接照抄的事件序号或卡片 ID：这些值必须来自当前工具结果，示例假值不能形成有效证据。参数字段即使格式正确，仍须通过执行时来源检查。部分 PTC 参数投影与报错提示的不足仍在[已知缺口](research/EXPERIENCE-REUSE-GAPS.zh-CN.md)中，不靠反复猜参数绕过。

## 使用计数、停止条件与隐私

卡片分别统计 `retrieved`、`used`、`checkedOutcomes`、`reportedFailures`。它们分别表示已投递、声明采用、后续检查完成和失败报告；任何一个计数都不等于相对无经验基线的收益。公开卡片明确标记 `independentQualityVerified:false`、`causalBenefit:false`，经验内容不具备授权效力。

读取和采用时重核项目、调用轮次、来源、合同与有效期。失败反馈会暂停卡片；来源撤回、变化、合同不匹配或到期使其不可用。原生证据不足、并发换轮、禁记、失去写锁时不会放宽检查来凑记录。来源读取缓存最多保留八个观察租约并在退出时释放。

运行账本位于所选 MNEMO 数据目录的 `successful-experiences/successful-experiences.json`，以及采集通道自己的来源账本。它们包含真实经验内容、证据摘录与元数据，必须留在部署者本地，不能随源码上传。发布和升级源码不要求重置账本，也不能据此解除旧冻结。

最小验证可在独立数据目录完成“实际动作 → 后续检查 → 保存 → 新轮明确检索 → 先采用再执行 → 后续检查”的链路，并检查禁记、来源失效和错误证据的拒用。不要把测试数据写入日常记忆。自动测试覆盖与人工验收边界见 [VALIDATION](VALIDATION.md)。
