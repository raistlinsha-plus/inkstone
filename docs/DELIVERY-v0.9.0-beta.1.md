# Inkstone v0.9.0-beta.1 · macOS 公证流程与源码预览

这一版交付面向 macOS 13 及以上的 Apple Silicon。发布工具核对 Developer ID 签名、Hardened Runtime、签名时间戳及对应源码提交，提交 Apple 公证，将票据附到应用，再对最终 ZIP 解包复验。核验通过后生成校验文件与回执。

| 交付项 | 本轮范围 |
| --- | --- |
| 本机应用 | 使用临时签名，沿用现有备份、原位升级与回退流程。应用标题显示 `0.9.0-beta.1`，系统版本字段使用 `0.9.0` |
| GitHub 预发布 | 提供源码和 SHA-256 校验文件 |
| 公开 macOS 安装包 | 等待 Developer ID 签名、Apple 公证、干净 Mac 安装与升级回退验收，以及二进制分发许可复核 |

源码预览适合愿意本机编译的测试者。按快速开始构建后，可以先用虚构资料试验 Markdown 编辑、关键词检索与原文跳转。维护者可在发布手册中查看签名、票据和验收步骤。 [快速开始](QUICKSTART.md) · [macOS 发布手册](MACOS_RELEASE.md) · [本机升级与回退](LOCAL-INSTALLATION.md)
