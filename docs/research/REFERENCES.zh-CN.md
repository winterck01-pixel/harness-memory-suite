# 文献来源、借鉴关系与证据边界

这些文献支撑设计选择与待检验假设。本仓库没有声称完整复现下列 22 项研究，也没有因引用论文获得自动学习或生产安全保证。论文作者按学术规范保留署名；实际任务、凭据、部署位置与协作配置不随文献公开。

## 借鉴关系

|文献编号|证据类型|本项目采用或计划采用|限制|
|---|---|---|---|
|1–4|神经科学理论、动物实验、计算模型|具体经历与概括分层；按条件分支；复盘价值启发|人脑机制不是 LLM 外部记忆的效果证明；未实现神经仿真|
|5–6|代理任务实验|外部反馈、失败与成功对照、条件候选|反思文本和投票不是独立验证；重试不等于迁移|
|7|特定交互环境的技能系统|程序资产应可执行、测试、撤回|未复现原环境；不能外推生产权限安全|
|8–9|代理记忆/上下文实验|原子条目、显式关联、增量版本|关联不是因果；不是已复现的整套算法|
|10|预印本中的记忆更新实验|保留具体案例基线，检测条件丢失|v1 摘要与正文部分百分比不一致，因此不引用该数值；不能外推所有模型|
|11|记忆注入攻击实验|来源信任不因摘要而升级；撤回和隔离|防护需要独立攻击验收；引用攻击论文不等于已防住|
|12|容错流处理系统|持久游标、幂等消费、恢复对账|实验文件存储不等于分布式事务；不能保证外部副作用恰好一次|
|13–14|真实软件任务接口与基准|观察质量、真实产物和工具任务验收|本项目实验不是原基准成绩复现|
|15|因果推断框架|分离观察关联与候选展示总效应|没有干预/可识别条件，不能从旧日志推断无偏收益|
|16–17|随机日志与 bandit 离线评估|仅作后续选项|当前日志无已知倾向和充分支持，不使用 IPW/CRM 宣称效果|
|18–20|统计风险控制与序贯推断|明确独立单位、校准、漂移及持续查看条件|当前小样本不满足推广保证；未启用 conformal 或置信序列晋级|
|21|约束策略优化|硬约束与收益分开作为设计动机|没有训练底层模型，也不继承论文的策略安全保证|
|22|次模优化定理|拟议非负覆盖选择目标|带 token、冲突和依赖的实际选择器不自动获得普通贪心的保证|

项目采用的三值过滤、证据状态机及阶段守卫是可审查的工程组合，并非声称某篇论文给出了这套完整系统。完整公式、符号与假设见[设计第 6 节](EXPERIENCE-LEARNING-DESIGN.zh-CN.md#6-数学模型与选择理由)。

## 原始来源

以下链接优先使用论文原文、会议或作者机构；预印本固定版本时按该版本解读。MINJA 引用 v1 原题，后续版本标题有所变化。


以下引用支持对应研究论点；工程协议、状态机和组合公式是本方案设计，尚未验证。作者预印本不等同同行评审结论。

1. McClelland, McNaughton & O’Reilly (1995). *Why There Are Complementary Learning Systems in the Hippocampus and Neocortex*. [作者全文](https://web.stanford.edu/~jlmcc/papers/McCMcNaughtonOReilly95.pdf)。理论/计算与证据综合。
2. Tse et al. (2007). *Schemas and Memory Consolidation*. [作者机构](https://www.research.ed.ac.uk/en/publications/schemas-and-memory-consolidation/)。大鼠实验，不能直接外推 LLM。
3. Mattar & Daw (2018). *Prioritized Memory Access Explains Planning and Hippocampal Replay*. [作者全文](https://www.princeton.edu/~ndaw/md18.pdf)。规范计算模型。
4. Gershman, Blei & Niv (2010). *Context, Learning, and Extinction*. [作者全文](https://www.cs.columbia.edu/~blei/papers/GershmanBleiNiv2010.pdf)。潜在原因计算模型。
5. Shinn et al. (2023). *Reflexion: Language Agents with Verbal Reinforcement Learning*. [论文](https://arxiv.org/abs/2303.11366)。环境反馈与语言反思代理实验。
6. Zhao et al. (2023/2024). *ExpeL: LLM Agents Are Experiential Learners*. [原文](https://arxiv.org/html/2308.10144v3)。失败/成功轨迹提炼。
7. Wang et al. (2023). *Voyager: An Open-Ended Embodied Agent with Large Language Models*. [论文](https://arxiv.org/abs/2305.16291)。特定环境中可执行技能库。
8. Xu et al. (2025). *A-MEM: Agentic Memory for LLM Agents*. [原文](https://arxiv.org/html/2502.12110v1)。原子笔记与关联组织。
9. Zhang et al. (2025). *Agentic Context Engineering: Evolving Contexts for Self-Improving Language Models*. [原文](https://arxiv.org/html/2510.04618v1)。增量上下文维护。
10. Zhang et al. (2026). *Useful Memories Become Faulty When Continuously Updated by LLMs*. [v1 原文](https://arxiv.org/html/2605.12978v1)。预印本；持续抽象的退化和条件丢失，本文不引用其不一致百分比。
11. Dong et al. (2025). *A Practical Memory Injection Attack against LLM Agents*. [原文](https://arxiv.org/html/2503.03704v1)。记忆投毒攻击研究。
12. Akidau et al. (2013). *MillWheel: Fault-Tolerant Stream Processing at Internet Scale*. [作者机构与论文入口](https://research.google/pubs/millwheel-fault-tolerant-stream-processing-at-internet-scale/)。容错流处理系统。
13. Yang et al. (2024). *SWE-agent: Agent-Computer Interfaces Enable Automated Software Engineering*. [原文](https://arxiv.org/html/2405.15793v3)。接口与真实软件任务。
14. Jimenez et al. (2023/2024). *SWE-bench: Can Language Models Resolve Real-World GitHub Issues?* [论文](https://arxiv.org/abs/2310.06770)。真实仓库问题及测试验收。
15. Holland (1986). *Statistics and Causal Inference*. [作者机构条目](https://www.ets.org/research/policy_research_reports/publications/article/1986/ajqr.html)。本次使用该机构条目；完整识别假设在方案中另行写明。
16. Li et al. (2011). *Unbiased Offline Evaluation of Contextual-bandit-based News Article Recommendation Algorithms*. [论文](https://arxiv.org/abs/1003.5956)。随机日志下的离线评估。
17. Swaminathan & Joachims (2015). *Counterfactual Risk Minimization: Learning from Logged Bandit Feedback*. [会议原文](https://proceedings.mlr.press/v37/swaminathan15.html)。倾向加权与方差控制。
18. Bates et al. (2021). *Distribution-Free, Risk-Controlling Prediction Sets*. [论文](https://arxiv.org/abs/2101.02703)。风险控制预测集，不自动适用于当前代理轨迹。
19. Barber et al. (2023). *Conformal Prediction Beyond Exchangeability*. [作者全文](https://www.stat.cmu.edu/~ryantibs/papers/nexcp.pdf)。非交换条件需要明确控制。
20. Howard et al. (2021). *Time-uniform, Nonparametric, Nonasymptotic Confidence Sequences*. [论文](https://arxiv.org/abs/1810.08240)。满足相应条件下的时间一致推断。
21. Achiam et al. (2017). *Constrained Policy Optimization*. [会议原文](https://proceedings.mlr.press/v70/achiam17a.html)。特定策略优化保证，不能移植为 API 代理安全保证。
22. Nemhauser, Wolsey & Fisher (1978). *An Analysis of Approximations for Maximizing Submodular Set Functions—I*. [原文 PDF](https://thibaut.horel.org/submodularity/papers/nemhauser1978.pdf)。保证依赖目标及约束形式。

本目录列出可公开访问的原始论文、阅读范围和适用限制。私有研究备忘录与原始会话不随仓库发布。
