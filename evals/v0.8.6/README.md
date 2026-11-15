# v0.8.6 有据问答评测

六份合成资料和十二道留出题覆盖日期与旧记录、否定和单位、局部缺项、冲突来源、文档范围及多轮追问。题集与[评分规则](RUBRIC.md)已冻结，摘要见 [SHA256SUMS](SHA256SUMS)。评测作者与本版问答生产逻辑的实现者分开。外部盲评另行记录。

常规 Rust 测试核对题集、证据原文和范围约束。离线报告入口为 `evaluation_v086::offline_grounded_holdout`，只需设置 `INKSTONE_086_REPORT` 并使用下方相同的 Cargo 参数，可复现[当前结果](RESULTS.md)。显式在线评测在临时文档空间和会话库中调用生产检索、证据组装、流式问答与引用检查。问答和证据分别评分。该评测不要求打开桌面窗口，操作系统界面验收另行进行。

在 macOS 已保存服务配置及对应地址的钥匙串凭据后，可运行以下命令。将报告路径改为已存在的个人目录中的新文件。评测使用标准构建，钥匙串可能要求授权当前测试程序。

```sh
INKSTONE_086_LIVE=1 INKSTONE_086_MODE=rerank \
  INKSTONE_086_REPORT=/path/to/new-grounded-report.json \
  cargo test --locked --manifest-path src-tauri/Cargo.toml --lib \
  evaluation_v086::live_grounded_holdout -- --ignored --exact --nocapture
```

使用 `rerank` 会准备合成资料的向量索引，并测试融合和重排。使用 `keyword` 会以本地 BM25 取证，只调用已保存的问答模型。每次运行最多 40 次 HTTP 尝试和 240 秒，超时与服务错误会留在报告中。所有题均禁用网页搜索，联网另有独立冒烟测试。未选中的押金草稿保留在本地合成索引，作为文档范围的反例。

报告包含合成问答、片段、实际使用的检索模式、重排状态、HTTP 尝试和延迟。钥匙串信息保留在进程内。模型费用和逐条语义正确性需独立查看服务账单和人工复核。
