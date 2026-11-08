# Inkstone v0.7.8 · Source preview

Write in local Markdown, build a source-linked Wiki, and ask questions with the documents you choose. This source preview rolls up v0.7.4 through v0.7.8.

## What changed

- **More precise evidence selection.** Separately check independently phrased questions and keep the original passages from conflicting sources. Verified Wiki aliases can help locate specific kinds of facts. In the fixed 17-question synthetic regression, necessary original passages entering the answer context rose from 12/19 to 19/19. The benchmark measures selected evidence.
- **A clearer first session.** Browse documents before attaching them, explicitly select a whole space, stop or retry a response, and open its saved citation. Wiki review opens the published page so you can continue checking original sources.
- **Motuan motion pilot.** The optional ink-and-pixel cat has idle, reading and milestone expressions, plus the acquaintance scene *An Afternoon Beneath the Bookmark*. Focus and reduced-motion settings keep the image still. [Preview the scene](../../../src/companion/assets/motuan-pilot-cg.svg)
- **Reliability from v0.7.4 and v0.7.5.** Restore draft source scope and per-turn web permissions, check source versions before opening historical citations, and diagnose Brave connectivity separately from webpage readability.

## Try it

Build from the v0.7.8 tag on macOS 13 or later with Apple Silicon. Start with the fictional reading-activity notes, attach the two notes to a question, and open an original passage from the answer. For Motuan, open the companion settings and choose gentle companionship. [Quickstart](../../QUICKSTART.md) · [Fictional reading-activity notes](../../../examples/v0.7.3/README.md)

The release includes a source archive and its SHA-256 checksum. Developer ID signing, notarization, cross-machine installation and live Brave account verification have separate acceptance gates. The publisher’s direct Brave probe timed out before receiving an HTTP response. [Known limitations](../../KNOWN-LIMITATIONS.md)

## 中文发布说明

砚台 v0.7.8 源码预览累计包含 v0.7.4 至 v0.7.8。可以从本地 Markdown 写作开始，把选定资料整理成带原文链接的 Wiki，再在独立问答中按轮选择资料。

- **证据更完整。** 分问分别核验，资料冲突时保留双方出处。17 道固定合成题里，进入回答上下文的必需原文从 12/19 增至 19/19。
- **首问和 Wiki 审阅更顺畅。** 浏览后明确勾选文档或整个空间。可停止、重试、打开原文，也可在审阅后直接打开生效的 Wiki 页面。
- **墨团动效试点。** 像素水墨形象加入待机、陪读、里程碑表情和动效，相识阶段解锁「纸签下的午后」。专注和减少动态设置保持静态。
- **历史内容更好恢复。** 草稿记住所选资料和本轮联网限制，历史引用打开前会校验原文版本。Brave 诊断可分别显示搜索接口与网页正文的状态。

本次提供源码压缩包及 SHA-256 校验和。真实 Brave 帐号的搜索和引用链路待网络可达时验证。 [三版交付导航](../../DELIVERY-INDEX-v0.7.8.md) · [检索对照](../../../evals/v0.7.6/README.md) · [墨团试点](../../DELIVERY-v0.7.8.md)
