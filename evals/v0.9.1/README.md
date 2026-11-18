# v0.9.1 有据问答评测

[冻结题集](grounded-holdout.json)包括 40 道中文合成题，分五组资料。覆盖日期、版本冲突、否定、复合请求、缺证、短追问与范围外干扰。固定答案和原文见[评分规则](RUBRIC.md)及题集。使用临时空间、索引和会话。多文档题在仅纳入所选文档的评测空间运行，单文档题会检查同一空间的未选文档是否进入上下文。

离线评测走文档工作台的关键词检索、追问门控和上下文组装，无模型调用。输出 JSON 路径必须是已存在目录中的新文件。

```sh
INKSTONE_091_REPORT=/absolute/path/inkstone-offline.json \
  cargo test --locked --manifest-path src-tauri/Cargo.toml --lib \
  evaluation_v086::offline_extended_holdout -- --ignored --exact
```

线上评测建议分别运行 `keyword`、`hybrid` 和 `rerank`。它从本机保存的服务设置读取地址绑定的凭据；混合检索需要嵌入设置，重排模式另需重排服务。线上评测仅使用合成资料并关闭公开网页搜索。每次最多 160 次 HTTP 尝试或 600 秒，密钥保留在进程内。 macOS 可能要求给运行测试的程序授权。

```sh
INKSTONE_091_LIVE=1 INKSTONE_091_MODE=keyword \
  INKSTONE_091_REPORT=/absolute/path/inkstone-live-keyword.json \
  cargo test --locked --manifest-path src-tauri/Cargo.toml --lib \
  evaluation_v086::live_extended_holdout -- --ignored --exact
```

输出按题列出必要原文、来源、耗时和请求数。需依据评分规则逐条核对回答和引用，再记录分数。独立问答中显式选择文件或添加会话附件的路径、真实 Wiki 生成与 Brave 联网需要各自的验收记录。

## 本轮离线对比

| 样本 | 改动前取齐 | 改动后取齐 | 必需片段前后 | 越出资料范围 |
| --- | ---: | ---: | ---: | ---: |
| 原冻结 12 题 | 6/9 | 9/9 | 8/11 → 11/11 | 0/12 |
| 新冻结 40 题 | 13/34 | 13/34 | 16/48 → 16/48 | 0/40 |

旧题中，普通故障的两个时限、两份相冲突的预约材料，以及简短末班追问恢复了所需原文。新题的中文改述、复合提问仍常漏掉原文。这两组运行没有调用模型。准确率和引用支持率需要独立的真实服务结果与人工核对。
