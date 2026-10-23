# 日常任务恢复与受限经验复用

日常闭环接在原生工具事件和下一次提示组装中，不另开一套模型评测任务。

1. 当前任务出现真实工具错误后，下次组装提供恢复状态，要求把目标拆成 2～4 个可验收步骤、记录改变的做法，再推进当前路线。同因重复失败要缩小问题、换方法或报告阻塞；权限拒绝不能靠换工具绕过。
2. `mnemo_experience` 的 `recovery_plan` 保存当前任务计划。它不证明成功，也不授予权限；具体怎么拆、怎么执行仍由当前模型负责。
3. 结束时，现有执行采集器保留来源与条件。仅当来源仍有效、机制已登记且宿主的独立验证通过，才形成独立的受限经验卡。
4. 下一次同项目、相关工具任务按需收到最多一条条件提示；实际采用时用 `use_daily` 登记。采用之后出现相关失败会暂停该卡；过期、来源撤回或契约变化也停用。

首个自动验证域是工具激活时序。候选须包含真实的激活失败及后续修复，另由现有官方 ToolRuntime 完成固定的本地契约检查。检查不调用模型、不提交图片或视频生成，不执行候选自由文本；卡片正文采用宿主固定模板。其他错误经验仍留待人工审查，普通成功任务不因完成一次就产生已学会的结论。

`dailyLearning.enabled` 是显式的窄域授权。旧的 `safety.frozen`、统计晋升门槛、历史失败与曝光记录保持独立；受限经验卡不会自动改写普通长期事实、用户规则、权限或工具配置。日常状态通过 `mnemo_experience(action="daily_status")` 查看，应同时显示旧晋升冻结和日常受限复用的状态。

该通道依赖 `executionExperience.enabled` 和已经核对的合同指纹，省略 `dailyLearning.enabled` 时关闭。`ttlMs` 默认一天；账本位于 MNEMO 数据目录的 `daily-experience/daily-experience.json`，不得提交到公开仓库。只想启用此无模型评测的通道时，应另显式设置 `autoLearning.enabled: false`。配置生成器不会开启这些可选项；[成功方法卡片](SUCCESSFUL-EXPERIENCES.zh-CN.md)还需要自己的 `successfulExperiences.enabled`，不能用日常卡片状态推断它已启用。

安装目录与仓库布局不同时，应由部署方在 `dailyLearning.sandboxOptions` 显式配置 `contextPolicyPath`、`contextPolicyDependencyRoots` 和 `hostDependencyAnchor`；测试可通过 `MNEMO_TEST_SANDBOX_OPTIONS` 传入同一组 JSON 配置。这些配置不能来自模型或候选内容。

异步恢复提示与经验卡仅加入本次 assembly 的 accepted contexts，不注册同名空 provider，避免宿主 `refreshContext()` 在请求准入时覆盖内容。验收应检查原生 `runtime-context` 的实际消息内容以及后续工具结果；投递计数不能证明模型收到或采用。程序内部被捕获、没有原生错误事件的异常，不自动作为已验证失败经验。

这证明的是指定低风险机制的运行和复用，不代表通用自主学习，也不代表复杂任务一定会成功。模型计划、经验投递和声明采用都不能冒充经过独立验证的任务收益。
