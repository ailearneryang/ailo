# macOS 安装包与 GitHub 发布

## 源码与安装包

README 中的 DMG 安装流程是分发目标。GitHub 源码上传不会执行构建；`out/` 被忽略，安装包应作为 GitHub Release 附件单独上传。当前 Forge 配置未启用 Developer ID 签名或 Apple 公证。

## 在 Mac 上构建

打包者需要 Node.js/npm，以及 macOS 打包工具。首次下载源码后在项目根目录执行：

```bash
npm ci --prefix apps/desktop
npm run make:dmg
```

输出目录：`apps/desktop/out/make/`。应用版本取自 `apps/desktop/package.json`；当前为 `0.1.62`。默认按当前机器架构生成，Apple Silicon 构建为 arm64，仅针对 M 系列 Mac。ZIP 备用包用 `npm run make:zip` 生成。若 DMG 失败，保留错误日志并检查 macOS 的 hdiutil/磁盘映像权限，不能把失败的输出作为安装包发布。

建议上传前将最终 DMG 命名为 `Ailo-0.1.62-mac-arm64.dmg`，并记录 SHA-256：

```bash
shasum -a 256 /path/to/Ailo-0.1.62-mac-arm64.dmg
```

## 发布前验证

- 使用新 macOS 用户或干净机器安装，确认拖入 Applications、启动、退出与重新启动正常。
- 确认没有预置个人注册信息、对话、模型地址/密钥或连接凭据。运行数据应留在用户的 Application Support 目录，不能复制进应用。
- 用户自行配置模型服务；账号目前为本机账号，并非云端账号同步服务。
- 桌面聊天不要求用户安装 Node.js/Rust；Android 等开发执行任务所需工具链需要单独验证和说明。
- 正式推广前用 Developer ID 证书签名并完成 Apple 公证。Forge 配置入口为 `packagerConfig.osxSign` 与 `packagerConfig.osxNotarize`，凭据存储在钥匙串或发布环境的 Secrets 中，不进入源码。当前配置尚未启用这两项。

## 上传 GitHub Releases

1. 确保本次打包对应的源码已提交并推送，核对应用版本。
2. 打开 https://github.com/ailearneryang/ailo/releases ，选择 Draft a new release。
3. 选择对应源码提交，创建版本标签（例如 `v0.1.62`）。不要重复使用已有版本标签发布不同代码。
4. 标题可用 `Ailo 0.1.62 — macOS Apple Silicon 预览版`。说明支持的架构、安装方式、模型配置要求、已知限制以及签名/公证状态。
5. 上传最终 DMG，可附 ZIP 和 SHA-256 校验值。GitHub 自动附带的 Source code ZIP 不属于桌面安装包。
6. 未签名/未公证版本勾选 Pre-release，先小范围内测；附件和说明检查完成后发布。
7. 发布后将实际 Release 下载链接加入 README，再用于推广。

参考：[GitHub Releases 官方说明](https://docs.github.com/en/repositories/releasing-projects-on-github/managing-releases-in-a-repository)、[Electron Forge macOS 签名说明](https://www.electronforge.io/guides/code-signing/code-signing-macos)。
