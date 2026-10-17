# 接入兼容宿主

1. 核对固定 SDK 依赖版本、插件加载方式和宿主提供的 services。源码集不包含完整宿主发行版。
2. 在隔离宿主把 `packages` 下所需目录复制到操作者选择的插件根。保留 `context-policy` 与 `dsh-skill-lifecycle` 的相邻目录关系。部署目录不携带本仓库的开发 `node_modules`，模块依赖由兼容宿主提供，避免重复 SDK 实例。
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
