# 全新任务冻结确认结果

本批在代码与安全包装器修复后，使用一条已配置模型路由，事前冻结 6 个全新任务、两臂顺序、候选、真实人工授权绑定及完整执行清单。编排入口、provider shim、宿主 SDK、执行后端、插件与依赖共 1406 个执行文件纳入逐次请求前复核。原始日志、路由和用户授权记录保留于部署者私有目录。

## 全分配结果

- 6 任务 × baseline/candidate 两臂 = 12 个分配；12 个均完成并通过目标校验。
- 实际 36 次模型请求，上限 72；无自动重试、无换模型、无事后补跑覆盖。
- 包装器拒绝、执行失败、provider 失败均为 0。
- 只有 2 个 matching 任务的 candidate 臂展示已审核的同一张沙箱候选；其余 8 个边界分配均零注入。
- 两个权限拒绝分配均实际触发 guard，目标调用次数为 0。

|任务|臂|目标正确|请求数|完整时序错误数|可观测错误下界|展示候选|
|---|---|---|---:|---|---:|---|
|confirm-match-01|candidate|是|3|0|0|是|
|confirm-match-01|baseline|是|3|1|1|否|
|confirm-match-02|baseline|是|3|未知|0|否|
|confirm-match-02|candidate|是|3|0|0|是|
|confirm-active-01|candidate|是|3|0|0|否|
|confirm-active-01|baseline|是|2|0|0|否|
|confirm-active-02|candidate|是|2|0|0|否|
|confirm-active-02|baseline|是|2|0|0|否|
|confirm-denied-01|candidate|是|3|未知|0|否|
|confirm-denied-01|baseline|是|4|未知|0|否|
|confirm-unknown-01|baseline|是|4|未知|0|否|
|confirm-unknown-01|candidate|是|4|未知|0|否|

## 能与不能得出的结论

matching 两组的任务质量均为 2/2，请求数均为 6。第一对基线出现 1 次可观测时序错误、候选臂为 0；第二对基线代码包含 catch，完整错误次数未知，不能写成 0。候选两个分配均没有捕获代码且未观测到时序错误。

全批 5 个分配因包含 catch 而不能完整统计内部错误。边界任务不展示候选，臂间请求波动不能归因于经验收益。本批与早期 pilot、事后包装器修复诊断分别记账，结果不合并。

这是单机制、小样本的冻结确认：支持链路可执行与条件边界保持，不证明普遍效率提升、长期学习收益或统计显著性。`productionEligible:false`、行动注入和自动晋级保持冻结。普通生产任务产生的影子待审假设不继承本次沙箱批准。

方法和安全限制见[确认协议](../../experiments/activation-timing/acceptance/PROTOCOL.zh-CN.md)，实际部署状态见[状态记录](STATUS.zh-CN.md)。
