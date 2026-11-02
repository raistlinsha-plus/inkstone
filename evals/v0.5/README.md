# v0.5 中文检索评测

`natural-chinese.json` 包含 30 篇虚构的独立任务文档及 100 个自然中文问题。内容覆盖会议、导入、图表、日程、脑图、表格、精度、来源版本、币种、信息缺口和提示注入。它不含用户资料，也不是独立留出的真实业务质量基准。

90 题可以从资料回答；5 题有相关文档但缺少所求信息；5 题没有相关答案。`expected` 标注唯一相关文档，`answerable` 标注所求信息是否充分，因此“存在相关文档”不等于“可以回答”。当前评测是文档级检索，不能据此计算切片级效果或生成答案正确率。

## 本地关键词基线

在仓库根目录运行：

```sh
cargo test --manifest-path src-tauri/Cargo.toml natural_chinese_keyword_baseline_and_external_corpus_guards
```

报告写入 `artifacts/v0.5-development/v0.5-natural-chinese-bm25.json`。使用真实生产 BM25 与切片，不模拟关键词分数；不请求向量、重排或问答 API。

Recall@20、MRR@10、nDCG@10 按 95 个有相关文档的问题统计；另外 5 个问题统计候选证据误判代理指标。资料不足题即使检索到相关文档，也不能被判成答案已经正确；生成答案、引用支持和正确拒答指标保留为 `null`。

## 显式远程对照

远程入口默认忽略，只有显式运行才请求服务。先通过运行环境配置以下变量，不把密钥写进仓库：

- `INKSTONE_EVAL_BASE_URL`：兼容服务地址。
- `INKSTONE_EVAL_API_KEY`：向量服务密钥，本地无鉴权服务可省略。
- `INKSTONE_EVAL_EMBEDDING_MODEL`：向量模型名称。
- `INKSTONE_EVAL_CORPUS`：明确选定的语料 JSON 的绝对路径。Cargo 测试进程从 `src-tauri` 目录运行，不能直接传入相对仓库根目录的 `evals/v0.5/natural-chinese.json`。
- 可选重排：`INKSTONE_EVAL_RERANK_ENDPOINT`、`INKSTONE_EVAL_RERANK_MODEL`、`INKSTONE_EVAL_RERANK_KEY`。

```sh
# 在仓库根目录运行；密钥等其余变量由临时进程环境提供。
export INKSTONE_EVAL_CORPUS="$(pwd)/evals/v0.5/natural-chinese.json"
cargo test --manifest-path src-tauri/Cargo.toml remote_hundred_question_retrieval -- --ignored --nocapture
```

指定外部语料后，报告写入 `artifacts/v0.5-development/retrieval-remote-100.json`。不指定语料时，沿用历史内置 100 题合成集，报告写入历史 v0.4 目录；测试名保留以兼容已有运行方式。

外部 JSON 结构为 `{ "documents": [{"path":"文档.md","text":"正文"}], "cases": [{"question":"问题","expected":"文档.md","kind":"类型","answerable":true}] }`。无相关文档时 `expected` 为 `null`。允许 1–200 篇文档、1–1000 题，文件最多 8MB；文档路径必须为相对路径，不能越出隔离目录，且标注必须指向存在的文档。评测不会扫描应用文档库。

远程对照使用配置的真实向量与可选真实重排，分别报告 BM25、向量、RRF 与重排排名，并保留原始问题记录、语料哈希、模型和阶段。向量输入批量发送，因此批量耗时不能当在线查询 p95；生成答案正确率、首字时间与未取得的计费金额均保留为空。本入口不自动校准重排阈值，也不把分数当作回答正确概率。

## 2026-10-29 真实远程检索结果

已使用本合成集运行现有 `remote_hundred_question_retrieval` 入口，测试通过，执行耗时 113.58 秒。仅发送显式选定的虚构语料和问题，没有扫描用户文档库、读取钥匙串或生成答案。凭据仅通过临时进程环境提供，未写入报告或仓库。

服务为 `https://aihubmix.com/v1`，向量模型为 `text-embedding-3-small`；重排完整端点为 `https://aihubmix.com/v1/rerank`，模型为 `qwen3-reranker-0.6b`。本次向量批大小为 8、单条上限 1,800 字符，未显式指定维度；重排最多 40 个切片候选、每条最多 2,400 字符、证据门槛为分数 ≥0.5。评测入口将重排超时设为 10 秒，这与产品默认 3 秒不同；本次未调参或重新校准阈值。

| 检索阶段 | Recall@20 | MRR@10 | nDCG@10 | `expected:null` 样本的证据误判代理 |
| --- | --- | --- | --- | --- |
| BM25 | 1.000000 | 0.994737 | 0.996115 | 0/5 |
| 向量 | 1.000000 | 0.986842 | 0.990122 | 0/5 |
| RRF | 1.000000 | 0.994737 | 0.996115 | 0/5 |
| 重排 | 1.000000 | 1.000000 | 1.000000 | 4/5 |

排名指标分母是 95 个 `expected` 非空样本，其中包含 5 道资料不足题，不能把检索到相关文档视为可以回答。报告中的 `noRelevantDocumentCases`、`unanswerable` 为另外 5 个 `expected:null` 样本计数；这些样本仍可能有主题相近的文档，例如活动安排并不包含实时天气。它们不是“文档库里完全没有相关主题”的证明。

重排在本合成集提升了排名，但 0.5 阈值使 5 个未标注相关文档样本中的 4 题存在被判为可用证据的候选。这是需要优先校准的证据资格误判代理，不能记成 4 次真实错误回答，也不能宣称重排已提升答案可靠性。未重排的向量组仍使用词法覆盖判断证据资格，0/5 也不是语义拒答准确率。下版应区分主题相关、事实支持与答案充分性，并使用独立标注资料校准阈值；本轮不据此修改产品门槛。

167 条向量输入（67 个切片及 100 个问题）的累计批量耗时为 26,084ms。逐题重排耗时 p50 为 770ms、p95 为 1,299ms；这些数据不含答案生成，不能作为完整问答或原生界面性能结论。

原始结果保存于 [检索报告](../../artifacts/v0.5-development/retrieval-remote-100.json)：

- `summaries.{bm25,vector,rrf,rerank}.{recallAt20,mrrAt10,ndcgAt10,evidenceFalsePositives}`：四组文档排名及证据代理指标。
- `records[]`：100 个问题的 `expected`、`answerable`、各组 `top10` 及排名，便于逐题审查。`answerable` 为真 90 个、为假 10 个；`summaries.*.answerableOrInjection=95` 是沿用历史字段名的相关文档计数，并非可回答题数。
- `corpusHash`：`ee4ef9e7baf1981c3a44b6f867cd627a85a40663881cca4965fdf462d89a67da`；`corpusSource=explicit-json`，`corpusDocumentCount=30`，`corpusCaseCount=100`。
- `embeddingInputCount=167`、`embeddingBatchWallMs=26084`、`rerankP50ms=770`、`rerankP95ms=1299`；`rerankerStatus=completed`。
- `answerGenerationRun=false`、`labelIndependenceEstablished=false`。所有 `records[].answerQuality`、`citationSupport`、`correctRefusal` 均为 `null`；`onlineQueryEmbeddingP50ms`、`onlineQueryEmbeddingP95ms`、`firstTokenP50ms`、`firstTokenP95ms`、`providerBilledCost` 也均为 `null`。未取得的数据继续留空，不推算答案、费用或实时延迟。

另一本机交互验收发现：把较长的 Markdown/chart 格式要求与问题一起送入检索，可能因词法覆盖门控产生假阴性，即资料有证据却拒答；缩短问题后，模型能返回合法的 `sourceRefs:["S1"]` 图表，数值匹配，转存后可继续编辑。前者是已知检索问题，不能计作正确拒答；后者只是该原生样例的功能验收，不纳入本次四组检索指标，也不代表生成答案质量已完成评测。

## 图表数值支持检查边界

后端仅检查模型 `chart` 的来源编号属于本轮证据、数值有限且没有超出安全整数范围，以及数值的十进制字面量在所声明资料中出现。可解析的完整、围栏及行内 JSON 中，字符串 ID 不作为数值；普通文本仍按数字出现匹配，不理解业务语义。格式化千分位按完整值比较，避免匹配其片段；比较不先转成浮点数，以免舍入把不同原值判成相同。

通过检查仍不代表类别、时间粒度、单位、数据口径或结论已核实。首版不自动执行派生公式。无法获得支持的块保留原文，通过 `rejectedCharts` 暂停绘制，并向用户提示核对。
