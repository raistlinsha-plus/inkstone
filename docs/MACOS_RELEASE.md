# macOS 公证发布手册

面向 macOS 13+、Apple Silicon 的公开 ZIP。v0.9.0-beta.1 的 GitHub 预发布提供源码及校验文件。公开安装包等待有效的签名身份、Apple 公证、干净 Mac 验收和二进制分发许可复核。需要本机构建时请使用现有本机升级流程。 [v0.9.0-beta.1 交付](DELIVERY-v0.9.0-beta.1.md) · [本机升级与回退](LOCAL-INSTALLATION.md)

## 签名与提交

在 Apple Silicon Mac 上检出拟发布的 Git 提交，使用 `toolchain.json` 规定的工具链。确认仓库干净，CI 已验证相同源码树。钥匙串须有 Apple Developer 团队签发的 **Developer ID Application** 证书和对应私钥。公证工具使用同一团队的钥匙串配置档。Apple ID 路径需要 App 专用密码，在 `store-credentials` 提示时输入。 [Apple Developer ID 指南](https://developer.apple.com/developer-id/) · [Apple 公证命令行文档](https://developer.apple.com/documentation/security/customizing-the-notarization-workflow)

```sh
security find-identity -v -p codesigning
xcrun notarytool --version

# 有可用配置档时，直接使用该配置档。
xcrun notarytool store-credentials inkstone-release \
  --apple-id "$inkstone_apple_id" --team-id "$inkstone_team_id"
```

将 `inkstone_signing_identity` 设为命令列出的完整 Developer ID Application 名称，并确认 `inkstone_team_id` 与证书中的团队相同。先构建签名应用，再为这份应用生成发行清单。命令清除 Tauri 自动公证需要的环境变量，统一由发布脚本处理提交与复验。 [Tauri macOS 签名指南](https://v2.tauri.app/distribute/sign/macos/)

```sh
npm ci --registry=https://registry.npmjs.org
env -u APPLE_ID -u APPLE_PASSWORD -u APPLE_TEAM_ID \
  -u APPLE_API_KEY -u APPLE_API_ISSUER -u APPLE_API_KEY_PATH \
  -u APPLE_CERTIFICATE -u APPLE_CERTIFICATE_PASSWORD \
  APPLE_SIGNING_IDENTITY="$inkstone_signing_identity" npm run bundle
node scripts/release-manifest.mjs

inkstone_app=src-tauri/target/release/bundle/macos/Inkstone.app
inkstone_manifest=artifacts/v0.9.0-beta.1-development/release-manifest.json
inkstone_output=artifacts/v0.9.0-beta.1-notarized
python3 scripts/macos-notarized-release.py package \
  --app "$inkstone_app" --manifest "$inkstone_manifest" \
  --team-id "$inkstone_team_id" --profile inkstone-release \
  --output-dir "$inkstone_output"
```

输出目录须尚不存在。脚本检查 Apple 返回的 `Accepted` 状态、提交 ZIP 的摘要和应用的代码签名摘要。公证票据附在 `.app`，脚本再生成面向用户的 ZIP，并从该 ZIP 重新展开应用，检查签名、票据及 Gatekeeper。Apple 的公证日志如有警告，按回执中的提交 ID 执行 `xcrun notarytool log <submission-id> --keychain-profile inkstone-release` 查看。若等待中断，可用同一配置档的 `notarytool history` 和 `notarytool info` 确认原提交状态。 [Apple 公证排错](https://developer.apple.com/documentation/security/resolving-common-notarization-issues)

本版在签名后的应用信息内记录 `CFBundleShortVersionString=0.9.0`、`CFBundleVersion=9001` 与 `InkstoneReleaseVersion=0.9.0-beta.1`。完整测试版号用于匹配发行标签。 [Apple 版本字段](https://developer.apple.com/documentation/bundleresources/information-property-list/cfbundleshortversionstring)

## 核对待发布文件

预期得到 `inkstone-0.9.0-beta.1-macos-arm64.zip`、`notarization.json` 和 `SHA256SUMS.txt`。使用批准的源码提交和签名团队核对最终文件。可在另一台 Mac 上执行这一步，验证机无需持有签名证书或公证账户。

```sh
(cd "$inkstone_output" && shasum -a 256 -c SHA256SUMS.txt)
python3 scripts/macos-notarized-release.py verify \
  --archive "$inkstone_output/inkstone-0.9.0-beta.1-macos-arm64.zip" \
  --receipt "$inkstone_output/notarization.json" \
  --team-id "$inkstone_team_id" --source-commit "$inkstone_source_commit"
```

核对发布页草稿对应的 Git 标签和源码提交。公开二进制时同时提供最终 ZIP、回执和摘要。若发布页有多个制品，把各制品及回执的校验值合并到公开 `SHA256SUMS.txt`。将原始备份、钥匙串、完整公证日志和真实测试资料保存在本机。

## 干净 Mac 验收

使用没有安装或运行过 Inkstone 的 Apple Silicon Mac 或干净虚拟机快照，至少覆盖最低支持的 macOS 版本和一个较新的版本。让 Gatekeeper 保持启用。通过 Safari 下载同一个待发布 ZIP，核对 SHA-256，确认仍有 `com.apple.quarantine`，随后在 Finder 解压并移到「应用程序」。这轮在首次启动前避免先做可能填充系统信任缓存的 CLI 评估。 [Apple DTS 的干净机器验收步骤](https://developer.apple.com/forums/thread/130560)

| 测试 | 做法与通过标准 |
| --- | --- |
| 首次离线启动 | 浏览器下载完成后断网，再双击应用。可以出现系统首次打开确认，确认后显示产品窗口 |
| 基本使用及重开 | 打开离线样例，创建并保存一篇 Markdown，关键词检索定位原文。退出并再次从「应用程序」打开，正文与文档身份一致 |
| 从旧版升级 | 在独立的测试快照中先运行 v0.8.7，建立虚构文档、编辑历史、会话和 Wiki。正常退出，保留旧应用、匹配的资料快照及可验证的便携备份，再用本轮签名应用启动。抽查文档、历史及空间归属，打开一条回答引用和 Wiki 来源 |
| 回退 | 保存测试版新增资料到单独快照，关闭应用并在测试机恢复匹配的旧应用及升级前资料。打开 v0.8.7，核对原有资料与历史。维护者可另行验证仓库的本机回退命令 |

记录测试日期、macOS 版本及构建号、芯片、制品摘要、测试结果和可复现的问题。首次离线启动失败时，从未访问过测试包的快照重试。通过后再公开下载安装文件。

## 二进制分发复核

复核拟发布二进制实际包含的运行时依赖、资源及上游署名，并核对归档内的 `LICENSE`、`NOTICE`、`THIRD_PARTY_NOTICES.md` 与适用许可文本。现有采集清单有 17 项缺少独立许可文件，包含开发依赖和可能进入 macOS/前端运行时的条目。逐项补充或记录来源与分发结论，再发布安装包。 [第三方许可清单](../THIRD_PARTY_NOTICES.md)
