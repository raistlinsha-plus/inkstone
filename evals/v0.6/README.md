# v0.6 问答评测与检索修复验证

`answer-review.json` 是 7 篇虚构资料、12 道问题的小型可审查样例，覆盖长格式要求、表格与图表、日期/负责人、时区、大整数、币种、JSON 字面量、资料缺口和提示注入。它不是独立留出的真实业务基准，不能作为总体准确率结论。

默认测试运行真实本地 BM25 准备过程，生成 `artifacts/v0.6-development/answer-review-template.json`，但不生成模型回答、不读 Keychain、不调用远程 API。每题包含检索问题、候选数量、证据资格和人工审查要求，`answerGeneration` 为 `not_run`，质量标签保留为空。

```sh
cargo test --manifest-path src-tauri/Cargo.toml answer_review_fixture_and_unrun_template_are_explicit
```

## 显式真实答案评测

只有单独执行默认忽略的 `remote_answer_review` 才调用真实问答服务。需在临时进程环境中提供：

- `INKSTONE_ANSWER_EVAL_CORPUS`：明确选定的语料 JSON 绝对路径，例如本目录中的 `answer-review.json`。最多 2MB、32 道问题，文档范围沿用隔离语料校验。
- `INKSTONE_ANSWER_EVAL_BASE_URL`：用户选择的 OpenAI 兼容服务地址。
- `INKSTONE_ANSWER_EVAL_MODEL`：明确指定的问答模型。
- `INKSTONE_ANSWER_EVAL_API_KEY`：该服务密钥；无鉴权本机服务可省略。密钥不写入文档、报告或仓库。

```sh
cargo test --manifest-path src-tauri/Cargo.toml remote_answer_review -- --ignored
```

入口只读取显式选定的语料，在临时目录建立生产 BM25 索引，以当前证据门控决定是否调用模型，生成时继续使用完整原始问题。它不扫描用户文档库、不读取保存的 Keychain 凭据，也不调用向量或重排服务。

报告逐题保存到 `artifacts/v0.6-development/answer-review-remote.json`。每题完成后保存进度；包含原问题、实际检索问题、来源文本/版本/行号、模型回答、完成原因、是否请求模型、耗时及现有图表数值校验结果。服务失败记为 `provider_error`，原始错误响应不进入报告。费用与人工质量结论未取得时继续为空。

`manualReview` 中的事实支持、引用支持、正确拒答以及类别/时期/单位，需要按每题 rubric 与实际来源逐项标注。不能把有候选、JSON 合法、图表未拒绝、请求成功或检索排名当作答案正确。建议标注人同时写明缺失事实、错误引用、单位混用或幻觉位置，保留失败题。

该入口测试当前关键词检索加真实生成，不是生产混合检索全管线的端到端质量报告。向量/RRF/重排对照继续使用既有显式检索评测；重排阈值仍需独立标注集校准，本版没有凭空修改 0.5 门槛。

## 输出格式与知识查询分离

生产检索会保守识别独立的格式要求，例如“请用 Markdown 表格和 chart 柱状图比较”“附来源”及合法 `sourceRefs` 列表；生成仍接收完整问题。知识查询不再被这些纯格式词稀释。

包含事实约束的混合句会保留，例如“请用表格展示和田2026年收入”，避免丢失实体、年份或限定条件；未知格式和复杂自然语言不强行改写。纯格式问题被保留为原文。日期、千分位金额、长编号、引号与 JSON 中的逗号有专门回归。

这是一项局部可解释修复，不能替代语义充分性判断。相关回归确认原长问题能重新得到词法证据，也确认没有积雪厚度资料时仍不会被标为证据。

## 凭据测试边界

`credentials` 模块测试全部使用测试闭包模拟延迟、取消、错误和密钥字符串，不调用系统 Keychain。测试覆盖同身份并发合并、超时后不叠加读取、不同角色/地址隔离、短期缓存过期、配置变化后丢弃旧结果及失败冷却。

真实 Keychain 授权、稳定签名更新和锁屏环境另作原生系统验收；默认 Rust 测试通过不代表这些系统行为已通过。
