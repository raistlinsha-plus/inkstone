# v0.7 GitHub 更新与传播包

2026-11-07；面向 **v0.7.0-rc.4 源码预发布**。本目录保存预发布的审阅材料；实时发布状态以 [Releases](https://github.com/raistlinsha-plus/inkstone/releases) 和 [Actions](https://github.com/raistlinsha-plus/inkstone/actions) 为准。下文记录素材用途和发布顺序，不作为实时状态面板。

## 可直接审阅的内容

| 材料 | 用途 |
| --- | --- |
| [英文首页](../../../README.md)、[中文首页](../../README.zh-CN.md) | 一句话定位、真实 UI、试用入口、数据外发与候选边界 |
| [快速开始](../../QUICKSTART.md)、[虚构阅读计划](../../../examples/v0.7/阅读活动方案.md) | 先不配置模型体验编辑和检索，再尝试首问/追问/拒答 |
| [Release 正文](RELEASE-NOTES.md) | PR 合并且目标提交 CI 通过后，粘贴为源码 **pre-release** 说明 |
| [PR 正文](PR-BODY.md) | 解释当前公开版到候选的变化、验证及剩余门槛 |
| [仓库元数据](repository-metadata.json) | About、12 个 Topics、拟定标签与素材路径；尚未应用 |
| [推广成稿与节奏](OUTREACH.md) | 中文开发者社区、英文技术社区和短帖草稿及两周衡量方式 |
| [发布审查](../../GITHUB-READINESS-v0.7.md)、[路线图](../../ROADMAP.md) | 可发布范围与尚不能承诺的事项 |
| [社交卡片](../../assets/launch-v0.7/social-preview.png) | 仓库 Settings → Social preview 上传；1280×640、不透明背景、低于 1MB |
| [分步演示 GIF](../../assets/launch-v0.7/workflow.gif)、[MP4](../../assets/launch-v0.7/workflow.mp4) | 五张实际界面截图组成的分步演示，不是实时录屏或模型速度测量 |

截图位于 `docs/assets/launch-v0.7/01-…05-*.png`。本轮重新捕获实际生产前端，使用隔离合成 IPC、虚构资料和模拟回答；不连接生产资料、钥匙串或真实模型。艺术来自产品现有静态候选素材，没有生成新的“概念 UI”代替实际界面。`capture-media.mjs` 保存采集过程；原始错误和审查回执另存在忽略的 artifacts。

GitHub 建议社交预览图用 1280×640、低于 1MB 的 PNG/JPG/GIF；提交图片文件不会自动设置仓库社交预览，仍需在 Settings 上传。[官方说明](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/customizing-your-repositorys-social-media-preview)。

## 发布顺序

1. 审阅本分支代码、演示和文案；提交 PR。保留原仓库和已有历史，增量更新，不另建“新版仓库”分散链接和 Stars。
2. 等待 **本次准确提交**在 GitHub 的完整检查及 Apple Silicon 构建通过。旧提交曾绿、当前本地通过都不等于本次远程绿。
3. 合并后创建 `v0.7.0-rc.4`，选择 pre-release，不标为稳定版；Release 正文使用成稿，核对其中 main 链接已能访问。
4. 仅附源码包及 SHA-256；源码包和清单在本轮私有 `artifacts/github-readiness-2026-11-07/release/` 准备。不得附本机数据、完整备份、旧程序归档或调试日志。
5. 应用 About/Topics，上传社交卡片；Homepage 暂不填写，直到有真实可访问的站点。截图必须保留合成演示说明。
6. 核对匿名访问、README/GIF、标签源码解包、链接与校验和；确认私密漏洞报告入口可用。随后按 [推广节奏](OUTREACH.md)逐个社区发布并回答反馈。

当前已有保护的 main 分支，已开 Issues，Discussions 尚未开启。先使用已有问题入口收集反馈；有持续讨论需求后再启用 Discussions。仓库公开设置与当前托管 CI 状态以本轮审查的查询时点为准。

## 对外口径

使用“macOS 源码预览”“自己的兼容 API”“可查看来源”“可选静态书房同伴”。暂不使用“一键安装”“全离线 AI”“已全面核验答案”“正式稳定版”“全平台”“像素动画桌宠”。把是否下载、是否收费、会向模型发送什么，在试用入口直接说明。

材料准备阶段没有执行远程写入。发布执行按上面的顺序核对；实际标签、Release 和检查状态见仓库，社区文案不代表已经发帖。
