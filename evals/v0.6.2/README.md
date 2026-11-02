# v0.6.2 检索与答案审阅语料

本目录提供20份原创虚构运行手册和100道中文问题，覆盖读书会、温室、骑行、展厅、食堂、档案、观测、志愿服务、工坊等领域。规则、机构、日期与数字均为合成事实，不使用本机私人文档，也不是旧版Inkstone功能FAQ的改写。

## 划分与标注

- 校准40题：30可答、10资料不足。
- 预留60题：50可答、10资料不足。
- 总计20道图表请求，标明类别、年份系列、单位、缺测与数值金标。
- 每题包含身份、split、可答性、金标来源/行号/原句、答案事实、引用格式及图表语义rubric。
- 两个split共享资料；问题与标注由同一开发者构造，模板化的图表和资料不足问题有相似结构。预留题只是版本冻结的开发预留集，不能称为独立用户测试、外部盲测或泛化证明。

`manifest.json`固定全部JSON内容的SHA-256；内容变动需要新版本，不能在查看预留结果后悄悄改题。`calibration.json`与`heldout.json`保留旧远程评测器所需的documents/cases/expected字段，额外标注不会丢失于原始文件。

## 本地复现

在项目根目录执行：

```sh
~/.cargo/bin/cargo test --manifest-path src-tauri/Cargo.toml --lib evaluation_v062::frozen_split_real_bm25_and_evidence_proxy_baseline -- --exact --nocapture
```

测试使用临时目录，运行生产代码的切片、FTS5/BM25、查询整理、候选合并、关键词证据门控与上下文准备。没有网络请求、没有Keychain读取、没有用金标造向量。结果保存在`artifacts/v0.6.2-development/evaluation/`。

先保存校准基线，再把预声明的候选目标及校准报告hash写入`frozen-targets.json`，最后运行60道预留题。已有冻结文件会被校验并复用。不得因目标失败而调低门槛；如需调参，下一版本另建语料与评测记录，不能继续把本轮预留题称为未见题。

预声明目标是Recall@5≥0.90、MRR@10≥0.80、金标原句进入上下文比例≥0.85、资料不足题的证据放行代理比例≤0.10。这是候选目标，不是已经实现的正确率。生产检索/拒答阈值本轮不调整。

报告中保留全部失败题、延迟与`not_run`阶段。测试通过只表示语料和评测流程可复现，不能表示所有质量目标通过。金标原句可用不等于生成答案正确；资料不足问题得到上下文是拒答风险代理，并不能单凭此断言模型编造。引用支持、事实正确性、真正拒答和图表语义质量，仍需真实生成及人工审阅。

## 显式真实API入口

已有`evaluation::remote_hundred_question_retrieval`是ignored测试，可对本版两个split分别执行真实embedding、向量、混合检索及可选rerank。包装器核对语料hash、固定split并把旧路径输出复制到本版目录，避免把旧文件当成本轮结果。

先显式配置环境变量`INKSTONE_EVAL_BASE_URL`、`INKSTONE_EVAL_EMBEDDING_MODEL`，以及所选服务需要的`INKSTONE_EVAL_API_KEY`。可选重排变量是`INKSTONE_EVAL_RERANK_ENDPOINT`、`INKSTONE_EVAL_RERANK_MODEL`、`INKSTONE_EVAL_RERANK_KEY`。凭据由调用者临时注入，脚本不获取应用生产密钥，也不把密钥写进报告。

```sh
node evals/v0.6.2/run-remote.mjs --split calibration --run
node evals/v0.6.2/run-remote.mjs --split heldout --run
```

这两步会产生真实API用量，默认测试不会调用。执行预留集前必须已有本地冻结目标文件。远程评测仍为检索评测，不生成答案；batch embedding用时不能当成在线逐问延迟，未取得的费用保持null。更换模型服务后必须记录新结果，不能沿用另一服务的质量声明。若要生成并人工审阅，按本目录rubric采样，保留原始证据、答案和失败样例，不能以重排分数代替逐值核验。

交付时的冻结报告副本在 `evidence/`，不会被后续本机运行的计时结果覆盖。运行中新报告仍写入 `artifacts/v0.6.2-development/evaluation/`；已见题复测始终不是新盲测。
