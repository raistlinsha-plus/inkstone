# v0.7 合成多轮冒烟检查

2026-11-05。默认离线测试不读取Keychain、不调用付费服务。`evaluation_v07::followup_missing_attribute_cannot_borrow_prior_question_coverage`使用实际assistant会话/安全指代解析、BM25、证据和上下文，验证首轮事实→追问报名人数→不存在预算；故意错误的旧AI预算不能进入新证据。

显式远程入口：`evaluation_v07::remote_multiturn_smoke`（默认ignored）。需临时环境变量INKSTONE_EVAL_BASE_URL、INKSTONE_ANSWER_EVAL_MODEL、INKSTONE_EVAL_API_KEY、INKSTONE_07_MAX_REQUESTS、INKSTONE_07_MAX_SECONDS和唯一INKSTONE_07_REPORT_NAME。单次最大24次/180秒，运行者另维护跨运行累计预留账本；本轮实际设置4次/180秒，累计上限8次/360秒，未消费余额不作为继续调用理由。

远程范围为本地BM25检索＋配置的真实chat服务，不包含向量/重排验证，不把此结果称为全RAG准确率。具体结果与人工复核见[结果](RESULTS.md)。
