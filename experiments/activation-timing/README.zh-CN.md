# 工具激活时序：经验学习垂直切片（实验）

这是隔离、可复核的第一条经验链：真实工具事件 → 持久消费 → 条件候选 → 审查记录 → 冻结沙箱对照。它不安装生产消费者，不自动注入记忆，不注册技能，不解除现有 frozen。

## 各部分职责

- `host/`：真实固定版本 ToolRuntime、context-policy 和官方 NodePtcRuntime；目标工具仅返回无副作用标记。未激活、同次激活后立即调用、未重新组装提示的新程序均可失败；提示重新组装后的新程序成功。
- `pipeline/`：按源序号幂等消费、冲突/缺失隔离、片段与条件候选、来源/内容/审核指纹、真人回执信任入口、沙箱冻结、三值检索及撤回。
- `capture.mjs`：消费真实宿主复现报告，生成候选与人工审查包；相同来源可重放，已有不同内容拒绝覆盖。
- `acceptance/`：全新任务冻结确认及生产影子组件边界测试；见[确认协议](acceptance/PROTOCOL.zh-CN.md)。
- `evaluation/`：真实模型决定代码动作，正向语法白名单限制文件、网络和任意代码能力；真实宿主执行；同模型两臂、全任务记录和结果验收。详见[冻结协议](evaluation/PROTOCOL.zh-CN.md)。

经验限定为：本宿主 `run_code` 开始时固定绑定，激活后必须返回，经过下一次提示组装，再以新 `run_code` 使用。它不是“等待一秒”，也不代表所有工具系统都采用这一合同。

## 本地复现

先按主 README 安装并准备宿主兼容层，在仓库根运行：

```sh
npm run test:activation
node experiments/activation-timing/host/setup.mjs
node experiments/activation-timing/host/reproduce.mjs /absolute/private/output/host-reproduction.json
node experiments/activation-timing/capture.mjs /absolute/private/output/host-reproduction.json /absolute/private/state /absolute/private/review
```

真实宿主后端为可选实验依赖，安装于忽略的 `host/.local`；普通项目测试不要求该后端。原始结果可能含异常堆栈或本地信息，输出目录必须在发布仓库外。测试夹具使用独立临时工作区和无业务副作用工具；它不是恶意代码的操作系统隔离沙箱。模型程序只能经过 `evaluation/safe-code.mjs` 白名单再执行。

`capture` 只产生 pending 审查包。`review(actorType:'agent')` 不是人类批准。`importHumanReviewReceipt` 要求由调用方验证实际外部人类回复，并绑定候选版本、内容和审查包；库本身不能认证本地管理员身份，也不宣称是密码学签名。

后续由调用者提供私有模型适配器、真实宿主工厂、经过条件过滤的冻结卡及真实人工回执，调用 `runEvaluation`，接口见[evaluation/README.md](evaluation/README.md)。适配器由部署方管理凭据，源代码中不写入密钥、真实模型名称或私人路径。

## 证据和限制

来源、开发诊断、正式对照分开。候选只在未激活、权限允许、合同指纹匹配时展示；已激活、权限禁止、其他合同、未知条件分别判断。后两臂结果相同也必须保留，不能通过削弱已有系统提示制造改善。

当前状态机和文件存储是实验单写者实现：原子替换及进程/实例重建，不承诺多写者事务或断电 fsync 持久性。内容哈希检测意外漂移，不抵抗能够重写整个受信 ledger 并重新计算全部哈希的管理员。

冻结对照仅一个错误机制、四个边界分层的小样本 pilot。测试通过、真人允许评估、冻结候选及模型最终成功都不单独证明长期学习收益；两臂都不犯错时应报告“未测出增益”。任何结果均不自动获得生产资格。
