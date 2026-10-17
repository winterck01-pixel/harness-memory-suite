# 冻结配对评估

`runner.mjs` 导出 `runEvaluation`，不包含模型凭据、不自动调用任何API。完整边界见 [协议](PROTOCOL.zh-CN.md)。

```js
await runEvaluation({
  complete,          // 私有适配器: ({messages, metadata}) -> {text, usage, finishReason, requestId}
  createHost,        // 真实host的createHostFixture；每臂全新实例
  candidateFor,      // task -> 经检索条件过滤后的单张冻结卡，或null
  mode: 'development', // heldout需要可信外部人工审查收据
  outputDirectory,  // 私有输出目录，不应位于公开仓库
  maxSteps: 6,
  providerIdentityHash,
  dependencies,     // 候选、host、pipeline、review包等摘要
});
```

`complete` 失败即停止后续网络请求；未开始臂仍保留。正式 heldout 还必须提交 `humanReviewReceipt`：`actor=human-user`、`decision=approve`、`externalMessageId`、`protocolHash`、`candidateHash`、`reviewPackageHash`。这几个字段只能绑定可信入口交付的审查，代码本身不能认证调用者身份。

目标结果来自真实工具执行与最终答案联合验证。工具时序分类要求外层program错误、目标名、缺绑定快照、同program成功激活同时出现；单独未激活调用属于availability错误，不混为激活时序。保留每个实验臂的原始事件和对话用于独立复核。

```sh
node --test experiments/activation-timing/evaluation/runner.test.mjs
```

这些测试验证评估器和安全边界，不能称为模型行为收益测试。实验限定在一个错误机制及四个边界分层，任何结果都不会自动解除 frozen 或产生生产注入资格。
