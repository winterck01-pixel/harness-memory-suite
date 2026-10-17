# 工具激活时序：真实宿主复现夹具

本夹具在独立 Cordis context 中使用真实已安装 `ToolRuntime`、当前仓库的 context-policy，以及官方 `NodePtcRuntime` 进程后端。目标工具仅返回固定 `FIXTURE_OK`，没有部署、重启、文件修改等业务副作用。没有修改生产插件。

这不是模拟宿主。`ObservedRuntime` 只记录实际交给官方后端的绑定名称，再调用 `super.run`；绑定生成、Schema 校验、激活、工具分派和错误都经过真实组件。

## 安装与执行

在仓库根先按主 README 安装依赖并运行宿主兼容准备，再运行：

```sh
node experiments/activation-timing/host/setup.mjs
node experiments/activation-timing/host/reproduce.mjs /absolute/private/output/host-reproduction.json
```

`setup.mjs` 仅将固定 `0.2.1-rc.2` 官方后端及本地服务装入忽略目录 `host/.local`，不修改根 package 或 lock。需要支持 `node:module.stripTypeScriptTypes` 的 Node；运行结果记录实际 Node 版本。重现报告含本机异常堆栈，应保存在仓库外的私人目录，不直接发布。

当前夹具随 RC2 前向更新，运行时读取并核对实际 SDK 与后端版本；历史冻结结果不因重新运行而改变，也不继承旧候选批准。

## 契约结果

1. 未激活目标调用：真实程序产生 `TypeError: tools.fixture_probe is not a function`。
2. 同一程序先激活再调用：激活真实成功，当前绑定仍无目标，程序产生相同错误。
3. 新开程序但没有重新组装提示：当前 policy 的 allowed 视图仍未更新，仍失败。
4. 重新组装提示后新开程序：实际目标工具执行，返回固定标记。
5. 已激活直接调用成功；不存在名称被激活层拒绝；独立权限 guard 仍拒绝；用户禁用所有工具时 transport 提前拒绝。

因此本合同的“下一步”准确条件是 **新的提示组装使 allowed 视图刷新，再运行新的程序**。等待时间、同一程序中的 `await` 或只更换程序都不满足这一条件。该结论限定在报告列出的源文件版本与哈希，不能推广到所有工具系统。

## API

```js
const host = await createHostFixture({
  targetName: 'fixture_probe', taskId: 'isolated-case',
  denyTarget: false, initiallyActive: false,
});
try {
  const observation = await host.assemble(); // 实际 sections、tools；临时 cwd 脱敏
  await host.runCode('return await tools.fixture_probe({});');
  const checked = await host.verify();
  const rawEvents = host.events;
} finally { await host.close(); }
```

`createHostFixture` 初始就组装一次提示；`initiallyActive` 额外执行真实激活及组装。`run` 与 `runCode` 等价，返回真实 `ToolResult`。`verify` 检查夹具执行计数，并将证据关联到目标实际调用的 callId；它只证明固定标记执行或预期权限未被绕过，不证明学习收益。

事件保留 sourceId、单调 seq、taskId、真实 callId、step、tool、contractFingerprint。事件类型含 assembly、binding-snapshot、action、result、verification；不可为缺绑定的目标捏造 action 事件，因为实际根本没有分派目标工具。其调用意图在实际 run_code 程序中，错误由外层 result 记录。人工候选应同时核对程序意图、实际绑定快照、激活结果与修复后的验证。

## 使用边界

- 真实系统提示已经明确写“下一步调用”。评估必须保留这条基线说明，不能通过删掉已有说明制造候选增益。
- `denyTarget` 使用独立宿主 guard，证明激活不授予权限；它不模拟用户确认 UI。
- 本宿主只实现 next-step 合同。立即生效、未知合同应是候选适用性检查，不能伪称该夹具实现了另一种真实宿主。
- 本 fixture 为受控实验采用显式 danger-full-access 部署策略，官方后端会启动真实 Node 子进程；它不是任意恶意代码安全沙箱。模型评估只能执行经过完整 AST 白名单检查的受限程序，禁止直接执行未经检查的任意 JS。
- `verify()` 默认“目标至少实际执行一次”；严格 exactly-once、输出匹配、错误统计与冻结对照由上层评估器另行判断。

## 流式采集恢复检查

`createHostFixture({onEvent})` 接受可选同步回调。每条真实事件写入内存后立即向回调发送独立副本；上层可以同步 `pipeline.ingest([event], {consent:true})` 持久化。回调失败会锁定采集错误，当前程序返回前抛出，并阻止后续程序和 assemble；这不会撤销故障前已经执行的动作。宿主观察者可能隔离异常，因此 wrapper 会在程序边界再次检查锁定错误，不能把该程序当作采集成功。

```sh
node --test experiments/activation-timing/host/streaming.test.mjs
```

测试使用全新独立来源：同次激活失败 → 重建消费 pipeline 实例 → 无新增人类消息的提示组装与真实调用成功 → 验证 → 完整事件重放不重计。它不替换原始审查候选。消费恢复不等于真实工具宿主进程重启，文件原子替换也不等于 fsync 或断电持久性；本夹具没有承诺这些性质。
