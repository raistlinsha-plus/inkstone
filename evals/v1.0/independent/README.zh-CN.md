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

## 在同一进程验证问答和 Wiki

桌面设置需已启用问答、向量和重排服务，并保存与各地址绑定的密钥。以下命令会实际调用这些服务，运行前请确认用量预算。在仓库根目录执行，保留该进程直至结束。

```sh
batch_parent="$(mktemp -d)"
INKSTONE_BATCH_LIVE=1 \
INKSTONE_EVAL_KEYCHAIN_WAIT_SECONDS=300 \
INKSTONE_BATCH_REPORT_DIR="$batch_parent/results" \
cargo test --offline --manifest-path src-tauri/Cargo.toml --lib \
  evaluation_v086::batch::live_saved_services -- --ignored --exact --nocapture
```

程序在发出模型请求前核对冻结题库，最多用 300 秒依次读取三个角色的绑定凭据。请在 macOS 弹出窗口时确认相应的系统授权。四个阶段共享进程内的凭据读取器。其正常的五分钟缓存按角色和地址生效，各角色首次授权或缓存到期后，系统可能再次询问。报告目录由程序新建，密钥只在进程内使用。

| 阶段 | 内容 | HTTP 请求上限 | 阶段时限 |
|---|---|---:|---:|
| hybrid-40 | 旧冻结集，混合检索 | 160 | 600 秒 |
| rerank-40 | 同一冻结集，重排 | 160 | 600 秒 |
| keyword-52 | 独立集，关键词检索 | 104 | 1200 秒 |
| wiki | 合成资料的 Wiki 编写与刷新 | 2 | 75 秒 |

如需在同一程序中比较三种模式，在这次运行的环境里加上 `INKSTONE_BATCH_KEYWORD_BASELINE=1`。它会在上述阶段之前增加 keyword-40，使用同一已冻结的 40 题，最多 160 次 HTTP 请求，时限 600 秒。

已启动阶段分别写入同名 JSON。整批状态在 `$batch_parent/results/batch.json`，记录各阶段是否启动、耗时、错误和报告文件名。若系统授权缺失、仍在等待或超时，整批停止。人工评分需另外核对原文和回答。

可用以下离线回归验证凭据缺失时只写一次诊断，且后续四阶段全部保持未启动。

```sh
cargo test --offline --manifest-path src-tauri/Cargo.toml --lib \
  evaluation_v086::batch::offline_missing_bound_key_stops_batch_before_any_stage -- --exact
```
