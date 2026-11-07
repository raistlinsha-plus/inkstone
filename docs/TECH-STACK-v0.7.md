# Inkstone v0.7 当前技术栈

2026-11-07；**0.7.0-rc.4 candidate**。以下版本读取当前`package-lock.json`、`src-tauri/Cargo.lock`及`toolchain.json`，不是仅列出依赖声明的范围。[4A架构](ARCHITECTURE-v0.7.md) · [候选交付](DELIVERY-v0.7-rc4.md)。

## 1. 工具链与目标

| 项目 | 当前值 |
| --- | --- |
| 平台目标 | macOS13+、Apple Silicon、`aarch64-apple-darwin` |
| Node / npm | 24.14.0 / 11.9.0 |
| Rust | 1.99.1，项目edition2021；另需Apple命令行开发工具 |
| 桌面运行时 | Tauri2与系统macOS WebKit，无内置浏览器服务 |
| 候选包身份/签名 | `local.inkstone.desktop`；ad hoc临时签名，未Developer ID、公证或跨机安装验收 |

## 2. 主要开源组件

| 组件与锁定版本 | 用途 | 上游许可摘要 |
| --- | --- | --- |
| React / React DOM19.3.1、TypeScript5.9.3 | UI与类型检查 | MIT / Apache-2.0 |
| Tauri Rust2.12.5；JS API/CLI2.12.4；dialog2.8.3 | 桌面壳、IPC、系统文件选择 | MIT OR Apache-2.0 |
| CodeMirror view6.43.15、state6.7.6、lang-markdown6.5.2 | 源码编辑、选择与语言支持 | MIT |
| Milkdown Crepe/Kit7.22.3 | Markdown正文编辑 | MIT |
| unified11.0.5、remark-parse11.0.0、remark-gfm4.0.1 | 共享Markdown解析/语法 | MIT |
| DOMPurify3.4.17、jsonc-parser3.3.1 | 呈现净化、JSON解析/结构操作 | MPL-2.0 OR Apache-2.0 / MIT |
| Mermaid11.17.2、markmap-view0.18.12 | 图示与脑图呈现 | MIT |
| ECharts6.1.0 | 受约束数据图表，不执行任意文档脚本 | Apache-2.0 |
| FullCalendar React7.1.3、temporal-polyfill1.0.1 | 日历呈现与时间处理 | MIT |
| lucide-react0.468.0 | 产品图标 | ISC |
| rusqlite0.37.0、SQLite bundled | 本机目录、索引与辅助数据库 | MIT；SQLite public domain |
| sqlite-vec0.1.9、jieba-rs0.7.4 | 向量索引与中文分词 | MIT/Apache-2.0 / MIT |
| reqwest0.12.28（直接依赖）、Tokio1.54.1 | 兼容服务HTTP、流式生成、异步任务 | MIT OR Apache-2.0 / MIT |
| pulldown-cmark0.13.6 | Rust侧Markdown/链接识别 | MIT |
| chrono0.4.45、chrono-tz0.10.4 | 时间戳、IANA时区和日界 | MIT OR Apache-2.0 |
| zip9.0.5 | 完整备份与校验 | MIT |
| Vite8.3.5、Vitest4.1.12、Testing Library React16.3.3 | 构建与合成自动回归 | MIT |

表内是主要组件，不是全部传递依赖清单。CodeMirror各包独立版本；Rust锁文件也含其他组件使用的reqwest0.13.5，不应把它当成应用直接HTTP依赖版本。完整文本/精确声明以[第三方清单](../THIRD_PARTY_NOTICES.md)、[许可目录](../licenses/)和锁文件为准。

## 3. 自研模块与数据契约

| 边界 | 当前实现 |
| --- | --- |
| `src/shell` / `src/platform` | 展示壳、IPC、布局偏好；App负责跨域编排 |
| 内容/编辑器/解析Worker | 共享Markdown与JSON/Mermaid/脑图/日程/图表契约，正文与源码往返 |
| Rust文档域 | UTF-8正文/附件、稳定ID、复制导入、冲突保存、显式来源更新、历史、恢复 |
| Rust检索域 | BM25+向量RRF融合，可选独立重排；证据、版本/范围、上下文预算与来源验证 |
| `src/assistant` / Rust `assistant` | 持久会话、分支候选、来源快照、草稿、请求归属与追问；独立SQLite schema1 |
| `src/companion` / Rust `companion` | 三角色章节、成长确认、去重、偏好和清空/导出；独立SQLite schema1 |
| Rust `maintenance` | 写入准入/排空、一致快照、领域校验和新目录恢复预演 |

catalog 为 **schema4**，index 仍为 **schema3**。会话库保存conversations/turns/candidates；角色库保存state/receipts/tokens/pending，文档和派生索引继续分别拥有内容与检索职责。**备份format2**纳入两个辅助库，兼容format1并提示旧包缺项，不伪造旧数据。

追问的资料身份与当前属性独立核对；此前最近至多6个用户问题、合计最多4000字符可进入生成语境，旧AI回答不能成为事实证据。角色经历/剧情不入RAG；启用的表达偏好只约束输出风格。角色成长不增加专属模型调用。

## 4. 用户API与本机数据

问答/向量使用用户自己的OpenAI兼容API，重排使用独立Cohere兼容端点；应用不提供模型托管或捆绑权重。服务设置与Keychain凭据分别管理，密钥不写入项目文档/完整备份，应用不保存macOS登录口令。

向量化外发选中片段；重排外发问题及候选摘要；生成外发当前问题、当前证据、有限历史用户问题及启用的表达偏好。关键词检索无需模型。远程服务使用HTTPS，本机回环允许HTTP。用户服务商的模型与计费不属于固定开源组件。

## 5. 构建与检查

```sh
npm ci --registry=https://registry.npmjs.org
npm run verify
npm run desktop
npm run bundle
```

独立包位于`src-tauri/target/release/bundle/macos/Inkstone.app`，运行时不依赖Node或开发服务器。`desktop-e2e`使用隔离应用身份、禁用系统凭据并限制为回环模型夹具；生产包不启用此feature。 本机仅保留 `/Applications/Inkstone.app` 作为日常安装，编译产物与压缩归档分别管理，详见[部署整理约定](LOCAL-INSTALLATION.md)。

本轮没有新增第三方依赖或变更锁定依赖版本。完整默认检查、隔离WebView冷启动、浏览器呈现与生产应用安装分别记录，最终结果见[rc.4审查](REVIEW-v0.7-rc4.md)。本轮未将真实WebKit交互、中文候选、Keychain授权、VoiceOver或多日自然成长算作通过；真实API冒烟也单独记录。


## 6. 开源与候选限制

Inkstone源码采用Apache-2.0；上游组件保留各自许可，不能概括成“全部MIT/Apache”。存在未修改的MPL-2.0传递依赖；已有清单仍记录20项独立本地许可文本缺口，二进制再分发复核未完成。临时签名、公开源码和正式二进制发行是不同交付范围。

角色资源当前为9张阶段形象与6张CG静态候选插画，已有hash/尺寸及来源说明；最终像素整理、sprite动画及资源签收仍待完成。已公开制品以 [Releases](https://github.com/raistlinsha-plus/inkstone/releases) 为准，当前候选不等同正式v0.7稳定发行。
