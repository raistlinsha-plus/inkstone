# 砚台 · Inkstone

Inkstone 是面向 **macOS 13 及以上 Apple Silicon Mac** 的本地 Markdown 工作台。把分散在不同目录的项目笔记导入一个空间，选出几篇整理成 Wiki，或直接问「原来计划几场，实际办了几场？」。点回答里的引用就能核对原句，把有用的结论保存成文档后，还能回到刚才写到的位置。

[浏览器交互演示](https://raistlinsha-plus.github.io/inkstone/) · [English](../README.md) · [获取 RC.4 源码预发布版](https://github.com/raistlinsha-plus/inkstone/releases/tag/v1.0.0-rc.4) · [操作手册](USER-MANUAL.zh-CN.md)

![v0.9.6 编辑器中的 Markdown 阅读活动方案，以及正文页边的墨团菜单](assets/v0.9.6/workspace.png)

图中是 v0.9.6 编辑器和虚构的活动笔记。开启书房同伴后，保存文档可以从页边记录一次经历。

**试用 RC.4** 时，可以打开一篇笔记，一次问两件事，然后逐条点开引用，看看原文能回答哪一项。你也可以启用模型辅助选句，授权其他工具只读搜索一个空间，或在撤回 Wiki 来源前查看受影响的版本。这一版仍会漏答有原文依据的问题。独立 AI 盲评中，40 道目标题有 15 道同时满足作答与引用要求，与 RC.3 持平。[RC.4 交付与验证](DELIVERY-v1.0.0-rc.4.md) · [外部工具接入](EXTERNAL-TOOLS.zh-CN.md)

## 可以怎样使用

- **把资料放在一起，保留原件。** 从不同目录复制导入 Markdown、TXT、JSON、Mermaid 文件到同一空间。用正文、源码或分栏模式写作，在正文插入表格、JSON 树、Mermaid、脑图、日程和数据图表。原件有变化时可比较差异，也可导出空间。
- **写到哪里，问到哪里。** 点「问这篇文档」，核对回答中的原文引用，点「返回写作位置」继续写。另起任务时可用独立 AI 问答翻译、改写，或为这一轮选择同一空间的资料及本地文本附件。
- **检查 Wiki 怎样得出结论。** 在「知识 Wiki」选择允许整理的文档，查看主题页提案，逐项核对来源、行号与原句。不同笔记记载不同时可并排查看，缺少依据时可仅发布已核验摘录。关键词、可选向量、Wiki 来源和可选重排帮助后续问答定位原文。
- **让同伴在页边陪读。** 墨团、砚舟和知微都有自己的像素形象，可停在编辑器任一侧，窄窗下收成书签。文档问答完成时角色会有短暂回应。确认经历后可逐步解锁故事、信物和插画。同伴支持专注、减少动态和关闭。[三位同伴的深浅色形象](assets/v0.9.6/companions.png)

## 开始试用

GitHub 提供源码归档和 SHA-256 校验文件。在 Mac 上准备 Apple 命令行开发工具、Node **24.14.0**、npm **11.9.0** 和 Rust **1.99.1**，然后运行下面的命令。[工具版本](../toolchain.json)

```sh
git clone --branch v1.0.0-rc.4 https://github.com/raistlinsha-plus/inkstone.git
cd inkstone
npm ci --registry=https://registry.npmjs.org
npm run desktop
```

1. **先试离线检索。** 在空间首页打开「从资料到第一条回答 → 用示例体验」，搜索「阅读活动」并从结果跳到原文。这一步无需模型密钥。浏览器演示也可以直接试，使用虚构笔记及模拟回答。
2. **再用自己的模型试问答。** 配置兼容的问答 API，导入两份样例笔记，分别核对计划场次和实际场次，再问笔记中有没有记录满意度。[两份笔记及示例问题](../examples/v0.7.3/README.md)
3. **日常独立运行。** 用 `npm run bundle` 构建本机临时签名应用，可独立于开发服务器运行。已有安装和资料时，先按本机升级流程备份和校验。[安装、备份与回退](LOCAL-INSTALLATION.md)

## 哪些内容会发给模型

编辑、关键词检索、同伴故事和资料备份都可以离线使用。文档、索引、Wiki、会话和同伴进度保存在这台 Mac 上。提问、整理 Wiki 或准备向量时，会向你配置的服务发送完成当前任务所需的问题、片段或选定材料。重排使用独立的 Cohere 兼容端点。服务商可能按调用量计费。

配置并授权 Brave Search 后，模型可按题决定是否搜索公开网页，Brave 接收经过校验的公开查询。也可以对单轮禁用搜索。服务密钥保存在 macOS 钥匙串。[安全策略](../SECURITY.md) · [检索与引用的适用范围](KNOWN-LIMITATIONS.md)

## 文档导航

| 想了解什么 | 阅读入口 |
| --- | --- |
| 入门与日常操作 | [快速开始](QUICKSTART.md) · [用户操作手册](USER-MANUAL.zh-CN.md) · [产品与功能总览](PRODUCT.md) |
| 实现与评测 | [4A 架构](ARCHITECTURE-4A.md) · [技术栈](TECH-STACK.md) · [文档问答配对评测](../evals/v1.0/rc4/README.md) |
| 版本进展 | [RC.4 实测结果与限制](DELIVERY-v1.0.0-rc.4.md) · [变更日志](../CHANGELOG.md) · [路线图](ROADMAP.zh-CN.md) |
| 反馈与贡献 | [试用交流](https://github.com/raistlinsha-plus/inkstone/discussions/11) · [贡献指南](../CONTRIBUTING.md) · [已知限制](KNOWN-LIMITATIONS.md) |

Inkstone 源码采用 Apache-2.0，上游组件保留各自许可，其中包含未修改的 MPL-2.0 组件。二进制分发所需的许可文本与美术来源复核进度可在项目中查阅。[许可证](../LICENSE) · [第三方清单](../THIRD_PARTY_NOTICES.md) · [角色素材说明](../src/companion/assets/README.md)
