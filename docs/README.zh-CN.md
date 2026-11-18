# 砚台 · Inkstone

**在 Mac 上编辑本地 Markdown，把选定资料整理成能核对原文的 Wiki。**

Inkstone 将 Markdown 写作、文档空间、Wiki 与独立 AI 问答放在一个 Mac 应用中。使用自己的模型 API，按本轮需要选资料，也可以选择让书房同伴陪你工作。

[浏览器交互演示](https://raistlinsha-plus.github.io/inkstone/) · [English](../README.md) · [源码快速开始](QUICKSTART.md) · [试用交流](https://github.com/raistlinsha-plus/inkstone/discussions/11) · [后续计划](ROADMAP.md)

演示无需安装，使用虚构笔记和模拟回答。可以点开引用核对原文，再试问一个资料里没有答案的问题。

开发源码为 **v0.9.2**，包含独立离线体验、首次问答配置、取证改进和 Wiki 最近变化。 [开发交付说明](DELIVERY-v0.9.2.md)

**GitHub 最新发布为 v0.9.0-beta.1 源码预览**，面向 macOS 13+ Apple Silicon。发布页提供源码和校验文件，公开安装包待 Apple 公证及独立安装验收。 [发布页](https://github.com/raistlinsha-plus/inkstone/releases/tag/v0.9.0-beta.1) · [中文宣传册 PDF](https://github.com/raistlinsha-plus/inkstone/releases/download/v0.9.0-beta.1/inkstone-v0.9.0-beta.1-brochure-zh-CN.pdf)

![砚台 v0.9.0-beta.1 带原文引用的问答示例](https://github.com/raistlinsha-plus/inkstone/releases/download/v0.9.0-beta.1/inkstone-social-preview.png)

首图使用新版的虚构资料和模拟回答。下方保留较早的 v0.7 界面演示。

## 可以怎样使用？

- **整理自己的资料。** 从不同本地位置复制导入文档空间，保留原件；显式比较来源更新，保留历史与备份。
- **让 Wiki 回到原文。** 在受管理空间选定资料，按主题整理，查看最近变更，核对原文位置。关键词、可选向量和 Wiki 定位共同召回原文，重排可以单独配置。
- **直接提问，按需加资料。** 在独立 AI 问答里解释、翻译或改写，或为当前问题选择一个空间、文档或文本附件。配置并授权 Brave Search 后，模型可按题自动查公开网页。查看每轮来源，将有用回答保存为文档。
- **直接在正文表达结构。** JSON、Mermaid、脑图、日程与受约束的 ECharts 图表可在 Markdown 正文内呈现和编辑。
- **选择安静的同伴。** 墨团、砚舟、知微提供阶段形象、固定故事及 CG。确认工作经历后成长，墨团可在温和陪伴中启用轻动效。

![虚构资料与正文图表](assets/launch-v0.7/01-editor.png)

![文档、问答、来源与不足信息追问的合成演示](assets/launch-v0.7/workflow.gif)

## 开始试用

先准备 Apple 命令行开发工具、Node 24.14.0、npm 11.9.0 和 Rust 1.99.1，然后：

```sh
git clone --branch v0.9.0-beta.1 https://github.com/raistlinsha-plus/inkstone.git
cd inkstone
npm ci --registry=https://registry.npmjs.org
npm run desktop
```

第一次编译需下载依赖。启动后在文档空间首页点击「打开离线样例」，搜索「阅读活动」，再从结果跳到原文。这一步无需模型密钥。配置兼容的模型 API 后，可以用两份虚构笔记练习添加资料、提问和核对引用。 [快速开始](QUICKSTART.md) · [两份笔记的完整示例](../examples/v0.7.3/README.md)

编辑和关键词检索无需模型。向量、Wiki 整理和问答使用自己配置的兼容模型 API，重排使用独立的 Cohere 兼容端点。文档、索引、Wiki、会话及同伴状态保存在本机。模型操作按用途发送问题、片段或选定资料，可能产生服务商费用。启用联网后，模型只根据当前问题规划搜索，Brave Search 接收通过规则校验的公开查询。密钥保存在 macOS Keychain。[安全策略](../SECURITY.md) · [联网范围](DELIVERY-v0.7.2.md)

`npm run bundle` 生成使用临时签名的独立本机应用。日常从 `/Applications/Inkstone.app` 打开，独立保留构建和测试包。 [本机版本及资料管理](LOCAL-INSTALLATION.md) · [macOS 公证发布手册](MACOS_RELEASE.md)

## 当前边界与参与方式

真实 Brave Search 帐号、原生辅助功能、干净 Mac 安装和更大语料评测等待单独验收。独立问答支持 TXT、Markdown、JSON、MMD 文本附件。PDF/OCR、云协作、单轮跨空间选取资料和悬浮桌宠列在后续范围。 [本地检索评测](../evals/v0.7.5/README.md)

欢迎提交虚构最小复现、可用性反馈和独立问答评测；不要上传密钥、真实资料或私人备份。[贡献指南](../CONTRIBUTING.md) · [已知限制](KNOWN-LIMITATIONS.md)。如果这个方向对你有用，也欢迎点一个 Star 帮助更多人发现。

源码采用 Apache-2.0，上游保留各自许可，包含未修改的 MPL-2.0 依赖；不能概括为“全部 MIT/Apache”。[第三方清单](../THIRD_PARTY_NOTICES.md)及角色资源来源说明保留当前复核边界。
