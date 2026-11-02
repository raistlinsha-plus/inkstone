# Inkstone v0.7 交互原型

独立离线设计样片，沿用纸色/墨绿桌面风格，不属于生产功能。

```sh
python3 -m http.server 28707 --bind 127.0.0.1 --directory prototypes/v0.7
```

浏览器打开 `http://127.0.0.1:28707/`，从“查看流程与场景”开始。index.html已内嵌CSS、JS和故事数据，双击可打开，无运行时本地fetch。修改维护源index.template.html、prototype.css或prototype.js后，运行 node prototypes/v0.7/build.mjs 重建单文件。

- 三角色、专注/温和陪伴、前三阶段成长、经历卡、故事分支、相册、偏好数据控制。
- 场景：初次选择、相识前一步、同行前一步、问答失败、经历写入失败。
- 角色/CG均为构图示意，最终9立绘/6CG未制作。
- 固定合成问答不调用API；CSP禁止网络连接，不读取生产资料/Keychain。
- localStorage键 `inkstone-prototype-v07-v1`；刷新保留演示，顶部可重置。
- 完整规格在仓库 `docs/PROTOTYPE-v0.7.md`，全文剧情与资产计划在本目录两个JSON。
- 检查：`node prototypes/v0.7/check.mjs`，不代替正式生产集成验收。

文件地址与本机HTTP是不同浏览器来源，各自保存独立状态。编辑格式工具为视觉示意，原型重点为陪伴交互。
