# 本机应用、版本与资料管理

本机升级工具从 **v0.8.5** 起复用同一套预检、备份与回退流程。日常使用 `/Applications/Inkstone.app`，Bundle ID 为 `local.inkstone.desktop`。

2026-11-07；当前统一使用 **v0.7.0-rc.4**。这是本机部署整理，不改变应用功能版本，也不代表正式 v0.7.0 或 GitHub 发行完成。

## 唯一日常入口

| 位置 | 用途 |
| --- | --- |
| `/Applications/Inkstone.app` | 唯一保留并向系统登记的日常应用；Dock、名称启动及其他程序调用均使用此入口 |
| `Inkstone` 主源码仓库 | 后续开发位置；当前编译缓存保留，避免下次开发从头编译 |
| 相邻的 `智能文本工具` 历史仓库 | 保留旧源码、Git 历史与项目文档；不再从这里打包或启动日常应用 |
| `~/Library/Application Support/local.inkstone.desktop` | 现有正式资料目录，包含受管理文档、历史、草稿、会话及同伴数据 |
| `~/Library/Application Support/local.inkstone.desktop.e2e` | 隔离测试资料，不与日常资料合并；隔离测试应用也不固定到 Dock |

多个生产应用副本原先使用相同 bundle ID 和同一资料目录。此次合并的是程序副本和启动登记，资料无需重复导入或拼接；保留原空间和文档身份。高级目录模式中的外部原件未移动。

## v0.8.5 起的本机升级流程

从 Apple Silicon Mac 上的主仓库运行。候选包由干净且已提交的源码构建，预检核对该提交、发行清单、ZIP 校验和、应用版本和签名完整性。

```sh
npm run bundle
node scripts/release-manifest.mjs
release_dir=artifacts/v0.8.5-development
ditto -c -k --sequesterRsrc --keepParent \
  src-tauri/target/release/bundle/macos/Inkstone.app \
  "$release_dir/Inkstone-v0.8.5-macos-arm64.zip"
(cd "$release_dir" && shasum -a 256 Inkstone-v0.8.5-macos-arm64.zip > SHA256SUMS)
python3 scripts/local-upgrade.py preflight --artifact-dir "$release_dir" --from-version 0.8.4
```

将预检输出的 `state` 路径保存到变量 `inkstone_upgrade_state`。预检会先展开候选应用，并预编译便携备份验收，因此此时可以继续使用旧版。保存文档并正常退出后，执行：

```sh
python3 scripts/local-upgrade.py apply --state "$inkstone_upgrade_state"
```

在同一事务内，原始快照保存应用资料、偏好和 WebKit 界面状态。便携备份从独立工作副本生成和验证。升级原位交换应用 Contents，保留应用根目录身份。安装验证失败时会尝试换回旧版。安装成功后新应用保持关闭，可先同步项目文档，再从原路径启动并验收。

若命令中断，应用应保持退出状态，使用同一事务目录重试同一命令。快照后如有正常编辑，重新预检并建立新的事务。需要恢复旧应用和旧资料时，退出应用后执行：

```sh
python3 scripts/local-upgrade.py rollback --state "$inkstone_upgrade_state"
```

回退会把当前资料保留在私有事务的 `return-stage`，恢复后活跃资料回到升级前时点。系统偏好和 WebKit 界面状态仅随原始快照备查。该目录、原始快照和便携备份均位于本机 Git 忽略的 `artifacts` 下。API 密钥仍由 macOS 钥匙串管理。可用 `python3 scripts/local-upgrade.test.py` 在临时目录验证故障和回退。

## 历史整理记录

旧 v0.6.2 应用已通过正常退出请求执行自身草稿/保存流程，没有强制结束。关闭后重新建立快照，覆盖 **336 篇**现有文档，并在副本上生成及校验完整产品备份。不能沿用前次 309 篇时点的快照代替本轮备份。

盘点共 11 个 `.app` 副本，仅保留主应用；其余 10 个副本先逐路径撤销系统登记，再清理。删除范围还包括历史仓库和 v0.6.2 临时检出目录中的生成构建缓存，以及重复保存的旧应用 Contents。源码、Git 历史、报告、截图、文档、外部原件及资料备份保留。

本次清理的分配空间约 **16.66 GiB**。同一测量窗口内，系统可用空间由 **11.44 GiB** 增至 **27.12 GiB**；APFS 共享块及系统后台活动使两者差值不等于目录统计之和。最新应用另存为一个经完整 ZIP 校验和二进制指纹核对的压缩包，压缩包不会注册成另一个可启动应用。

私有快照、备份、最新应用压缩包、逐路径清理计划和回执位于主仓库忽略的 `artifacts/local-consolidation-2026-11-07/`，不随公开源码提交。其中可能包含私人正文及本机路径，不能上传到公开 GitHub。

资料检查确认原有 336 篇文档的身份、标题、路径和状态全部保留；330 篇正文未变化，6 篇受控项目文档按来源更新。另新增本轮交付、评审、详细设计和本机管理 4 篇文档，合计 340 篇；13 份历史副本因来源或基线不可用而保留原样，没有强行覆盖。22 个 SQLite 文件完整性检查通过。

catalog 从 schema3 升至 schema4，索引仍 schema3。安装与资料迁移分开核对；旧程序无法直接读取升级后的 catalog。回退需要应用及匹配的升级前资料快照，不能仅恢复旧程序。

## 后续更新约定

1. 只从主源码仓库构建。`npm run bundle` 的输出仍是 `src-tauri/target/release/bundle/macos/Inkstone.app`，它是临时构建产物，不是第二个日常安装位置。
2. 更新前让运行中的应用正常保存退出，并建立完整资料备份。若应用取消退出，应处理其提示，不能强制结束后继续覆盖。
3. 核对构建版本、身份、签名及指纹后，更新唯一主应用；保留应用根目录身份，避免 Dock 书签指向失效对象。API 凭据及资料目录不随程序副本替换。
4. 留一份最新程序压缩包供恢复；验收完成后撤销临时/旧应用路径的系统登记并删除重复 `.app`。不要把旧目录改成 `.app` 符号链接，否则仍可能再次产生多个启动入口。
5. 将系统登记指向 `/Applications/Inkstone.app`，核对 Dock 路径，并通过 bundle ID 启动后检查实际进程路径。只核对桌面图标或版本文字不足以证明启动了正确程序。
6. 日常打开主应用；`npm run desktop` 和隔离测试仅用于开发，不能同时用旧版访问生产资料。历史交付文档中的包路径是当时记录，是否仍保留以本文件及最新回执为准。

本机包继续使用临时签名。此整理不改变 macOS 钥匙串或系统授权规则，不保存系统登录口令，也不承诺今后不会出现系统授权提示。
