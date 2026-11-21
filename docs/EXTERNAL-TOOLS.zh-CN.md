# 从其他 AI 工具检索 Inkstone 资料

此命令行工具随 1.0 候选源码提供。它在本机对已建索引的受管理文档执行 BM25 检索，外部工具可以用取回的原句完成自己的写作。支持中文。默认没有授权连接，桌面关闭后已授权的查询仍可运行。

## 建立第一个连接

1. 在 Mac 上按[源码快速开始](QUICKSTART.md)准备工具链并启动此版本的 Inkstone。在目标空间导入笔记，确认可以通过关键词检索定位原文。
2. 打开「模型与设置 → 外部工具」，填入工具名称，明确选择一个空间，点「创建只读连接」。空间里的现有及后续就绪文档都在授权范围内。如果只需分享少数材料，可以为它们建立专用空间。
3. 将一次展示的凭据放入该工具的环境变量 `INKSTONE_CLI_TOKEN`，把空间 ID 作为 `SPACE_ID`。在 macOS zsh 终端可用下列方式输入，凭据不会出现在输入历史里。

```sh
read -rs 'INKSTONE_CLI_TOKEN?连接凭据：'
export INKSTONE_CLI_TOKEN
read -r 'SPACE_ID?空间 ID：'
```

4. 在项目根目录构建命令行工具。产物位于 `src-tauri/target/release/inkstone-cli`，可将这个可执行文件的完整路径交给能在本机执行命令的助手。

```sh
cargo build --locked --release --manifest-path src-tauri/Cargo.toml -p inkstone-cli
src-tauri/target/release/inkstone-cli search --space "$SPACE_ID" --query '活动安排了几场？' --json
```

5. 在 `result.results` 选取相关结果，复制其 `ref` 值，核对原文。引用包含空间、文档、保存版本及行区间。程序重新检查当前授权与文档状态；笔记已改动时请重新搜索。

```sh
read -r 'REF_ID?搜索结果中的 ref：'
src-tauri/target/release/inkstone-cli read --space "$SPACE_ID" --ref "$REF_ID" --json
```

## 结果与权限

成功时标准输出是一条带 `protocolVersion: 1` 的 JSON，退出码为 0。搜索返回实际模式、状态、最多 12 个命中。每条命中包含标题、文档 ID、版本、行号、原文与引文标识。可读取片段上限为 40 行、2,400 个字符。遇到超长单行时查看 `truncated`。优先核对 `evidence: true` 的原文；`candidates_only` 表示只找到相关线索，`no_results` 表示没有可返回的命中。

失败时退出码为 1，标准错误含协议版本及错误码。`denied` 提示检查连接凭据、空间或撤销状态。`stale_reference` 表示当前原文已有变化。`reference_unavailable` 表示文档已移走或该引文不可读。`index_not_ready` 和 `upgrade_required` 需回桌面准备或更新索引。`temporarily_busy` 可稍后重试。

本机检索以只读方式使用已有的关键词索引。桌面与 CLI 同时访问时，SQLite 可为并发读写创建共享内存与事务日志辅助文件。它只提供受管理文档的有限原文，向量、重排、聊天、网页和 Wiki 生成属于桌面工作流。连接凭据独立于模型密钥。撤销后，后续通过该连接的访问会被拒绝。外部工具已经取得的片段、其模型服务的传输策略，以及它通过操作系统获得的文件权限，需要在该工具中管理。在新设备恢复便携备份后请重新创建连接。
