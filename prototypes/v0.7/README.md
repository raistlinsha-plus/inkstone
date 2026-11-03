# Inkstone v0.7 像素水墨与知识问答原型

2026-11-04修订，独立离线设计样片，不属于生产功能。完整入口为[产品设计](../../docs/design/v0.7/README.md)。

```sh
python3 -m http.server 28707 --bind 127.0.0.1 --directory prototypes/v0.7
```

浏览器打开本机28707端口；index.html内嵌CSS、JS、九章草案和四张概念图，双击也可运行，无CDN或运行时fetch。文件较大（约12MiB），用于可移交样片；正式应用采用资源manifest、缩略图及按需加载，不沿用全量base64内嵌。

- 先走“展开问答→比较人数→来源→追问满意度不足→保存/插入”；会话切换、范围变更、演示生成中止、修改问题和候选计数可操作。
- 再走“选择墨团→初遇→相识/同行场景→确认完成→主动读新章→相册→收起/关闭”。
- 顶部“角色美术设定”查看三角色与墨团书房CG；均为生成概念，9阶段立绘/6主CG仍待签收；不包含正式逐像素sprite动画。
- 固定比较/满意度不足情景不调用API；其他问题明确说明超出情景，演示流式为本地计时，不冒充真实SSE。
- 修改问题作为新一轮、候选仅计数、来源为固定弹层；真实分支/候选快照/数据库见设计规格。
- 保存新文档写演示空间，下载另生成MD文件；插入需预览，不覆盖已有笔记，不计成长。
- CSP禁止网络连接，仅读取浏览器独立演示键`inkstone-prototype-v07-v1`；不读取生产资料或Keychain。文件/HTTP来源分别保存状态。

维护源为index.template.html、prototype.css、prototype.js、chat.js和assets。修改后运行`node prototypes/v0.7/build.mjs`。状态检查`node prototypes/v0.7/check.mjs`：行为测试使用精简图片载荷控制内存，完整真实图像由浏览器检查；不替代生产Rust、WebKit、真实IME与模型验收。
