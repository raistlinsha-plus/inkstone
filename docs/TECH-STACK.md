# Inkstone 技术栈 · v1.0.0-rc.1

开发目标为 macOS 13 及以上版本、Apple Silicon。桌面包使用系统 WebKit。Node、npm、Rust 和 Apple 命令行开发工具用于从源代码构建。仓库固定 Node 24.14.0、npm 11.9.0、Rust 1.99.1，目标为 `aarch64-apple-darwin`。[工具链](../toolchain.json) · [桌面配置](../src-tauri/tauri.conf.json)

CLI 是同一 Cargo workspace 中的独立二进制，复用 Rust 的本地关键词检索和版本核对。CLI 协议版本为 1；桌面设置管理外部工具的授权，存储凭据摘要。[构建和使用](EXTERNAL-TOOLS.zh-CN.md)

## 主要组件

下表列出本版锁文件中的版本。完整依赖树见 [npm 锁文件](../package-lock.json)和 [Rust 锁文件](../src-tauri/Cargo.lock)。

| 职责 | 直接使用的组件 | 在 Inkstone 中承担的工作 |
| --- | --- | --- |
| 桌面与界面 | Tauri 2.12.5、Tauri JS API 2.12.4、dialog 2.8.3、React 19.3.1、TypeScript 5.9.3 | 原生窗口、文件选择、类型化前后端调用和应用界面 |
| 文档编辑 | CodeMirror view 6.43.15、Milkdown Kit / Crepe 7.22.3、unified 11.0.5、remark-gfm 4.0.1 | 源码及可视化编辑，解析 Markdown 和结构化内容 |
| 图形与日历 | Mermaid 11.17.2、markmap-view 0.18.12、ECharts 6.1.0、FullCalendar React 7.1.3、temporal-polyfill 1.0.1 | 流程图、脑图、受约束的图表、日历和时区处理 |
| 本机存储与检索 | rusqlite 0.41.1（内置 SQLite）、sqlite-vec 0.1.9、jieba-rs 0.7.4 | 事务、FTS5 关键词检索、中文分词与向量召回 |
| 服务与内容边界 | reqwest 0.12.28、Tokio 1.54.1、html5ever 0.39.0、DOMPurify 3.4.17 | HTTPS 调用、流式响应与取消、网页正文提取及渲染净化 |
| 凭据与备份 | keyring 3.6.3、macOS Security Framework、zip 9.0.5 | 系统钥匙串、便携备份打包和恢复校验 |
| 构建与测试 | Vite 8.3.5、Vitest 4.1.12、Testing Library React 16.3.3、Cargo | WebView 资源构建、界面测试、原生模块构建与测试 |

页边桌宠使用应用自有的角色图形、CSS 和 React 状态。桌宠通过应用内编辑区域定位，窄窗时改用书签尺寸。动作、章节与相册的展示可使用本地资源。[页边交互](../src/companion/CompanionPet.tsx) · [角色素材说明](../src/companion/assets/README.md)

## 服务接口与外发范围

| 服务 | 何时使用 | 请求中的内容 |
| --- | --- | --- |
| OpenAI 兼容 embeddings | 用户建立向量索引或执行语义检索 | 选定文档的分块，或本轮查询 |
| Cohere 兼容 rerank | 检索配置启用重排时 | 查询及候选片段 |
| OpenAI 兼容 chat | 生成回答、整理已授权 Wiki 或规划公开查询 | 按任务选择问题、上下文、原文证据或获准整理的资料。联网规划使用当前问题 |
| Brave Search | 授权自动联网，且本轮计划需要公开资料时 | 经过检查的公开查询词。随后读取可访问的公开 HTTPS 网页以取得原文 |

服务凭据由系统钥匙串保存。远程端点要求 HTTPS，本机回环模型端点可用 HTTP。模型由用户选择，服务费用和模型质量随所选服务而变。使用本地关键词检索无需配置这些服务。[提供方适配](../src-tauri/src/providers.rs) · [网页检索](../src-tauri/src/web_retrieval.rs)

## 如何核验

从仓库根目录运行 `npm ci` 安装锁定依赖，`npm run verify` 执行默认回归，`npm run desktop` 启动开发版，`npm run bundle` 生成独立应用。带 `desktop-e2e` 特性的原生测试包使用独立标识和回环服务夹具。真实服务调用、中文输入法、VoiceOver、自然使用观察与跨机安装各自记录验收范围。[快速开始](QUICKSTART.md) · [macOS 分发](MACOS_RELEASE.md)

Inkstone 源码采用 Apache-2.0。第三方模块保留各自许可证，其中包括 MIT、Apache-2.0、ISC 和 MPL-2.0 等。仓库提供许可证清单与文本，二进制分发需另核对其交付条件。[许可证](../LICENSE) · [第三方清单](../THIRD_PARTY_NOTICES.md) · [许可文件](../licenses) · [4A 架构](ARCHITECTURE-4A.md)
