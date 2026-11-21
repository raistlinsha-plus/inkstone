# 独立知识问答试卷

`questions.json` 收录 12 个情景、25 份虚构资料和 52 道中文题，由独立 AI 在查阅实现之前编写。每题的 `documents` 指定可用资料，`follow_up_to` 指定上一轮题号。当前 7 道追问均直接接续一道主问题。评分用答案单独封存，人工盲评独立进行。

在仓库根目录执行以下命令核对冻结试卷。预期 SHA-256 为 `6fd92300fede2d70bf01b4f882d048af7a1dd4513f3bb907c740c83de2ffe97f`。

```sh
shasum -a 256 evals/v1.0/independent/questions.json
```

## CI 离线复现

准备好 Rust 构建依赖后运行。该测试在临时目录索引每题的指定资料，走关键词检索与会话历史路径，核对全部 52 条记录、资料范围和 7 道追问的上下文，并检查 HTTP 请求计数为零。结果反映检索与会话链路的运行情况，答案正确性由真实作答和盲评另行检验。

```sh
cargo test --offline --manifest-path src-tauri/Cargo.toml --lib \
  evaluation_v086::independent::offline_public_packet_preserves_scope_and_history -- --exact
```

## 真实关键词作答

在已配置模型和地址绑定密钥的 macOS 环境中运行。钥匙串可能显示授权窗口。每次运行新建一个报告目录，模型请求最多 104 次，整轮时限 1200 秒。报告包含逐题回答、来源、会话历史和实际请求计数。

```sh
packet_report_dir="$(mktemp -d)"
INKSTONE_100_INDEPENDENT_LIVE=1 \
INKSTONE_EVAL_KEYCHAIN_WAIT_SECONDS=300 \
INKSTONE_100_INDEPENDENT_REPORT="$packet_report_dir/keyword.json" \
cargo test --offline --manifest-path src-tauri/Cargo.toml --lib \
  evaluation_v086::independent::live_keyword_packet -- --ignored --exact
```

报告位于 `$packet_report_dir/keyword.json`。授权超时会留下 `incomplete` 状态及失败阶段。
