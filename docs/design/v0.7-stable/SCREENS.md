# v0.7.0 关键画面与交互

以下均是独立原型的合成数据。当前应用的四步评审及原生截图见 [REVIEW.md](REVIEW.md)，业务规则见 [PRODUCT.md](PRODUCT.md)。场景条不属于正式产品界面。

## 1 稳定文档工作台

![1440 工作台](screenshots/01-workspace-1440.png)

左侧“文档 / 最近 / 回收站”固定，排序入口显示当前模式。置顶独立分组；打开正文只改变选中项，默认名称顺序不变。

## 2 独立最近视图

![最近](screenshots/02-recent.png)

刚打开的 100 文档出现在最近顶部，不影响空间文档默认顺序。最近是访问历史，不是组织文档的唯一方式。

## 3 回收站摘要与永久删除

![回收站摘要](screenshots/03-trash-detail.png)

![确认范围](screenshots/04-purge-confirm.png)

![未开始删除的失败状态](screenshots/05-purge-error.png)

标题点击不恢复；危险操作说明范围，并需输入确认。图中故障模拟属于评审工具。已进入不可逆阶段后的“清理未完成”是后端实现要求，本原型不模拟跨库恢复。

## 4 问答与来源

![多轮问答](screenshots/07-conversation-1440.png)

![来源预览](screenshots/06-source.png)

每轮结果、来源、候选和落文操作放在一起；缺少满意度资料时明确拒绝比较，不把人数推成满意度。

## 5 安静同伴

![手札](screenshots/08-companion.png)

同伴工作时占一行，手札由用户主动打开。图像为概念预览，最终阶段立绘与 CG 仍须单独签收。

## 6 窗口适配

![1280 工作台](screenshots/09-workspace-1280.png)

![960 编辑任务](screenshots/10-editor-960.png)

![960 问答任务](screenshots/11-chat-960.png)

![960 删除确认](screenshots/12-purge-960.png)

![1280 展开问答](screenshots/14-chat-1280.png)

窄窗保留资料导航，编辑和问答轮换；确认弹窗内容可纵向滚动，底部取消与危险操作固定可达。小窗口不强行挤出三个细栏。
