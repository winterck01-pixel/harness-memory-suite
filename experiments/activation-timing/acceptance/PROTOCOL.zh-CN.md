# 工具激活时序：接入后的独立确认协议

状态：实验规约；不是上线报告、人工批准或生产晋级。

## 两项独立验收

1. **系统功能验收**直接调用实际 MNEMO ActivationShadowCapture 接口，用宿主原生 session 事件验证：持久摄取、无新 human 输入、实例重建、重复、缺口、权限/用户禁用、scope 隔离、合同未知/变更、来源撤回。该组件不具备的绑定/权限/成功验证证据必须维持 unknown；needs-review 候选不能冒用上一轮候选的人工批准。
2. **行为确认**使用修正后安全包装器和隔离真实宿主，6 个全新任务 × baseline/candidate 两臂。2 条 matching、2 条 already-active、1 条 permission-denied、1 条 unknown-metadata。每臂最多 6 次模型请求，总上限 72；无自动重试、不换模型。原生系统提示保留，候选仅在适用条件已验证时展示。

## 事前冻结与执行

由可信私有编排器提供实际已配置的模型路由摘要、真实外部人工审查的验证回调、候选卡和检索 decisions、完整执行文件清单（包括编排入口、provider shim、runtime 后端）以及依赖版本。新合同指纹或候选变更不继承旧批准。

本次可信审查收据使用独立字段：`candidateId`、`candidateVersion`、`candidateHash`、`humanApproved:true`、`evaluationOnly:true`、`decision:accept`、`authority:observed-user-four-step-approval`、`scope:fresh-frozen-sandbox-only`。外部验证回调必须核对真实用户授权；字段自身不能证明真人身份。matching 必须恰好一张卡，其候选 ID、版本、内容 hash 和两项批准/沙箱标记须与收据相符；其他分层必须零卡。旧收据不自动变成本批或生产授权。执行前及每次冻结完整性检查也重新验证该结构。

先创建 freeze.json（独占创建），它包含任务、顺序、system、候选/拒绝决策、路由和人工批准绑定、全部执行文件摘要。本 runner/tasks/protocol、共享安全 AST 与旧 runner 也自动入清单。执行前及每次网络请求前重核所有文件；改变则停止并保留剩余未执行分配。清理错误不覆盖已有结果。任何 provider/合同/冻结错误都停止后续网络请求，不以修复诊断替换本批。真实 source/session、提示和响应只落私有目录，不进入 Git。

## 安全 API

允许 `activate_tool_group`、`search_capabilities` 和单个 harmless 目标工具；目标仅返回固定标记。使用现有完整 AST 正向白名单，禁止网络、文件、动态成员、原型、额外工具和代码构造。每臂全新隔离实际 ToolRuntime，不能用生产业务工具。权限拒绝由实际 guard 验证。

## 指标与解释

全分配保留（ITT）。首要目标为任务正确完成与权限保持。matching 组报告可观测的激活时序错误、任务质量和模型请求数；若执行代码存在 catch，完整错误次数记 unknown，另外报告可观察下界，不能将外层成功当内部无错。语义正确但无分派日志的权限报告与实际 guard 拒绝分开列示。

边界组不展示候选，故两臂差异不能归因于候选。统计单位为任务/机制组，不能将工具调用或 token 当独立样本。本批仅一个机制、小样本确认，无自动强化/晋级，productionEligible=false、frozen=true。

开发诊断在独立目录及预算中进行，不属于确认集。本轮不因观察到的结果调整任务、提示、顺序或卡片，不对失败臂补跑覆盖。
