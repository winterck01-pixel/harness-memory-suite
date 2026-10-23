# 接入兼容宿主

1. 核对固定 SDK 依赖版本、插件加载方式和宿主提供的 services。源码集不包含完整宿主发行版。
2. 全新克隆后先依次执行 `npm ci --ignore-scripts`、`npm run prepare:host`、`npm run build`、`npm run verify`。构建包含文件管理和媒体客户端；媒体生成产物不提交 Git，不能跳过构建就进行完整验证。再在隔离宿主把 `packages` 下所需目录连同已构建客户端复制到操作者选择的插件根；使用 `git archive` 时按 [README 导出步骤](../README.md#3-导出插件并准备宿主补丁)另行复制客户端。保留 `context-policy` 与 `dsh-skill-lifecycle` 的相邻目录关系。部署目录不携带本仓库的开发 `node_modules`，模块依赖由兼容宿主提供，避免重复 SDK 实例。
3. 确认目标 `@deepseek-ai/dsh-tools` 版本与补丁 manifest 相符。若需要应用补丁，使用操作者显式选定的包目录：

```sh
node scripts/apply-host-compat.mjs --package-root "$HOST_TOOLS_PACKAGE"
```

脚本在写入前检查原始文件；已经匹配目标时幂等退出；未知内容拒绝覆盖。当前仅支持 RC2：先在临时目录验证补丁，再复核目标摘要并替换；不保留旧软件版本或自动回切。维护时停止相关进程，异常在当前版本修复，配置和业务数据独立保护。

4. 生成仅保存在本地的配置草稿：

```sh
node scripts/write-host-config.mjs \
  --plugins-root "$HOST_PLUGIN_ROOT" \
  --memory-root "$MEMORY_DATA_ROOT" \
  --out "$LOCAL_CONFIG_FILE"
```

输出为 JSON 形式的 Cordis 插件数组，YAML 解析器也可读取。它只生成草稿，不安装、不重启、不修改全局配置。可选 `--router` 加入会话编排。宿主的实例/模板作用域、已有插件 ID、客户端加载方式和配置合并需要操作者审阅；不能直接重复挂载官方 skill loader 或已有模块。

5. 知识库的 credentials、连接授权和存储域沿用宿主服务。显式配置来源根、供应商及模型，默认禁用远程模型入口；不要复制已有机器配置或真实状态文件作为样例。
6. 在隔离数据目录验证工具发现/激活、技能检查与加载、知识授权、记忆整轮关闭、结果撤权及使用收据。通过后再安排自己的部署窗口。

可选路由包含对原生会话控制器的固定接口/版本/代码校验。其显式模型选择功能在不匹配时关闭，并保留其它可用路径；不能因源码可加载就宣称该桥接在其它宿主发行版已验收。

## 经验通道的宿主契约

经验功能复用已有 MNEMO 写者，不要求单独进程或运行数据迁移。配置生成器只设置基础 `dir`；成功方法、日常受限经验及模型评测按各自配置启用，不能复制其它机器的开关和合同指纹作为自己的环境认证。

|服务或契约|用途|缺失或变化时的行为|
|---|---|---|
|准确的活跃会话对象、工作目录、带序号的原生事件、当前轮身份|采集、工具调用身份和本轮禁记检查|缺少可信身份不采集或拒用；工具传入的会话名称不能替代它|
|`sessionPersistence.stat(id)`|检查来源存在、头部身份与修订；读取前后复核|无该服务时只支持准确的活跃会话；不能确认的冷来源不继续使用|
|`sessionQuery.observeSession(id, { projectionMode: "none" })`|以只读租约取得持久化来源事件|冷来源必须返回可信 `prepared` 观察、完整连续事件、修订和 `Symbol.dispose`；不满足则拒用|
|`schedule.catalog()`、`schedule.history()` 及原生交付消息|核对定时来源的任务身份、版本和实际交付回执|没有完整匹配回执时不能仅凭文字声称定时来源可信|
|官方 ToolRuntime、SystemPrompt 与本地 PTC 执行依赖|可选激活时序验证器的真实工具绑定与隔离检查|仅对应已核对的接口；缺依赖或合同变化时不可把机制标为验证通过|
|当前模型服务及可信策略文件|可选 `autoLearning` 模型配对评测|策略缺失不发起评测；提供方错误、取消、预算和结束原因独立记账|

只读来源桥最多保留八个租约，核对来源修订、删除和服务身份变化后才返回；不会恢复旧 Agent、重新执行任务或打开写者。旧来源读取能力不授予当前轮操作许可，经验工具仍须绑定当前活跃会话。宿主仅版本号相同而接口不同，也应视为未验证。

成功方法本身没有新增第三方运行依赖；工具激活沙箱还需要根依赖清单中的官方本地执行 SDK。保留仓库模块相对布局；非标准安装位置用部署者自己的 `contextPolicyPath`、`contextPolicyDependencyRoots`、`hostDependencyAnchor`，分别传入 `dailyLearning.sandboxOptions` 或 `autoLearning.activationTiming`。路径不能由模型或候选内容提供。

配置、操作与限制见[成功方法](SUCCESSFUL-EXPERIENCES.zh-CN.md)、[日常恢复](daily-experience.zh-CN.md)、[自动评测](auto-experience-learning.zh-CN.md)。升级源码不应改变既有记忆、审批记录、失败/曝光账本或冻结状态。
