# Inkstone v0.7.3 source preview

**打开独立 AI 问答，直接提问或为这一轮加资料。**

- 直接聊天、写作、翻译与解释。独立问答有自己的会话，文档侧栏继续用于空间或单文档问答。
- 每轮可选一个受管理空间，必要时限定其中最多 5 篇文档。也可附加最多 5 份 UTF-8 TXT、Markdown、JSON 或 MMD 文件，单文件上限 2 MiB。附件随会话保存在本机，原文件保留。
- 可以查看本轮使用的原文、附件、网页与未进入证据的范围。沿用 v0.7.2 的 Wiki 和可选 Brave Search，模型只根据当前问题规划联网。用户可明确保存有用的回答为文档。

**开始试用。** macOS 13+ Apple Silicon，中文界面，从本版本标签构建。配置兼容聊天 API，在左侧打开「AI 问答」，先改写一句虚构通知，再为下一轮添加一份文本并核对来源。问答会向你配置的模型发送问题和用于生成的资料。[源码快速开始](https://github.com/raistlinsha-plus/inkstone/blob/v0.7.3/docs/QUICKSTART.md) · [虚构样例](https://github.com/raistlinsha-plus/inkstone/blob/v0.7.3/examples/v0.7.3/README.md) · [v0.7.3 交付说明](https://github.com/raistlinsha-plus/inkstone/blob/v0.7.3/docs/DELIVERY-v0.7.3.md)

**交付边界。** 发布产物是源码预览，实际 Brave 帐号的端到端请求尚待验证。PDF/DOCX/OCR、图片、单轮跨多个空间的选取和任意代码执行列在后续范围。原生辅助功能、跨机安装与第三方二进制发行仍需单独验收。
