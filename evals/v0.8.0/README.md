# v0.8.0 评测

`rc-64.json` 是开发方编制的合成题集。12 份虚构资料，64 问含 52 道有明确目标证据的题和 12 道资料没有所问值的题。包含改写、数值约束、同名实体、原文未公布、否定、旧日期和跨文档对照。没有访问日常资料。该题集用于开发，正式评分还需要独立复核、未向开发流程开放的题目和逐条结论的人工判定。`manifest.json` 固定题集和协议摘要。

## 本地回归

```sh
cargo test --locked --manifest-path src-tauri/Cargo.toml --lib evaluation_v065::candidate_development_quality_report -- --exact --nocapture
```

报告写入当前包版本对应的 `artifacts/v<版本>/evaluation/local-rc-64.json`。其中 recallAt5 检查必需文档，goldEvidenceContextRate 检查全部必需片段。unsupportedEvidencePositive 表示缺少目标事实时仍组装了上下文，可能包含能支持拒答的原文，需要人工区分。答案正确性、引用支持率及提供方成本不会从本地检索反推。既有 v0.7.5/0.7.6 固定集另行核对 BM25 与 Wiki 辅助召回，继续使用历史门槛。

从 rc.2 起，goldStages 对每段必需原文分别标记候选、入证与进入上下文的状态。冻结开发集门槛为 52 道有答案题中至少 45 道完整覆盖，12 道缺少目标事实的题均不组装上下文。

## 显式真实服务

使用 [评测 runner](../v0.6.5/README.md) 已有的临时环境变量，执行 `node evals/v0.6.5/run.mjs --corpus rc-64 --run`。该入口分别运行 BM25、向量诊断、融合及融合重排，在预注册子集生成回答。由人工核对每个答案关键断言、引文支持、拒答、必要数字与单位。自动报告中的空值表示未测或未评分，不能计为通过。公网查询单独验收。

Wiki 实际生成和刷新使用独立烟测。请从受控的临时环境提供服务地址 `INKSTONE_ANSWER_EVAL_BASE_URL`、模型 `INKSTONE_ANSWER_EVAL_MODEL`、需要时的 `INKSTONE_ANSWER_EVAL_API_KEY`，以及不存在的报告绝对路径 `INKSTONE_WIKI_EVAL_REPORT`。

```sh
INKSTONE_WIKI_EVAL=1 cargo test --locked --manifest-path src-tauri/Cargo.toml --lib real_wiki_compile_and_refresh_smoke -- --ignored --nocapture
```

仅发送合成资料，最多两次实际 HTTP 尝试和 75 秒，不读取钥匙串。报告保存来源变更前后、真实模型输出和发布结果，质量需要按报告内的评审说明人工判定。
