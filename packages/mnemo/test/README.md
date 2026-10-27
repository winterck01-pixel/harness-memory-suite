# MNEMO 测试宿主配置

本插件是可单独复制的目录。完整集成测试需要官方 SDK，以及配套的 context-policy / dsh-skill-lifecycle 源码；不能假定它们位于桌面或某个固定父目录。

仓库根目录的 `package.json` 和锁文件固定 Cordis 4.0.5、Harness SDK 0.2.1-rc.2。先按仓库说明执行 `npm ci --ignore-scripts` 和 `npm run prepare:host`，然后在仓库根目录运行：

```bash
npm run test:memory
```

此命令通过 workspace 的 `node test/run.mjs --host-root ../..` 使用根目录 SDK，自动发现相邻的 `context-policy` 和 `dsh-skill-lifecycle` 源码。不会启动额外 Harness 服务或读取真实经验数据。

需要只读复用另一份完整 SDK 或使用非标准目录时，在仓库根目录显式提供路径：

```bash
npm test --workspace=dsh-mnemo -- --host-root /path/to/sdk-install \
  --context-policy /path/to/context-policy/index.js \
  --skill-lifecycle /path/to/dsh-skill-lifecycle
```

独立复制插件后，可以在插件目录直接运行 `node test/run.mjs` 并提供上述选项。不传 `--host-root` 时运行器以插件自己的 `package.json` 解析依赖；配套源码默认采用插件旁的 context-policy 和 dsh-skill-lifecycle。目录缺失会明确报错，不会跳过用例。也可通过 `MNEMO_TEST_SANDBOX_OPTIONS` JSON 提供同样的 `hostDependencyAnchor`、`contextPolicyPath`、`contextPolicyDependencyRoots`；命令行选项优先。

在选项后加 `-- test/activation-sandbox.test.js` 可单独跑一个文件。普通 lessons 单元/模拟接入测试可在仓库根目录运行 `npm run test:unit --workspace=dsh-mnemo`，不需要官方工具执行环境。上述测试只使用合成任务、模拟模型和临时目录；真实付费模型验证应由独立脚本明确选择模型与预算，不能混入 `npm test`。

运行器只把宿主依赖和配套源码的显式路径传给测试，不修改外层 node_modules、官方源码、真实记忆或冻结配置。激活测试仍使用真实官方隔离 runtime，不以模拟 runtime 或跳过断言掩盖缺少依赖。涉及源码变更的用例会先复制到临时目录再修改，原始宿主及配套插件始终只读。
