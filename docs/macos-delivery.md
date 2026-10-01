# macOS 安装与分发要求

## 用户体验

目标路径：下载 DMG → 拖动 Ailo 到 Applications → 启动 → 账号/模型连接首次设置 → 使用。

普通同事无需复制项目、安装 Node.js 或执行命令。应用本体与所需执行运行时随包提供；云服务地址随环境配置，不能指向开发者电脑的 localhost。账号、凭据和模型费用的供应方案需要在正式交付前落实。

首批优先 Apple Silicon；Intel 支持作为发布前待定项，未验证架构不得标为兼容。最低 macOS 版本在锁定 Electron 版本后依据官方支持范围确定。

## 实现方向

Electron + React + TypeScript，Electron Forge 打包。此为工程初始方向，尚未创建或验证工程。桌面壳与 Agent 核心分离，数据协议可由后续移动入口复用。

渲染界面不直接获得 Node 或任意命令执行能力；通过隔离的、输入校验过的通信接口访问文件和任务执行。选择的文件范围、任务目录、模型凭据和执行权限应明确管理。

## 分发阶段

1. 开发构建：本机启动与功能验证。
2. 内测构建：实际打包 app/DMG，在干净环境验证安装。未签名构建不等于正式可顺畅分发版本。
3. 正式分发：Developer ID 签名、Apple 公证并附加公证票据；建立版本化下载渠道。
4. 更新机制：配置更新来源、签名验证及失败处理，验证用户数据兼容后启用；不是已有能力。

Apple 开发者账号、签名证书、公证凭据和发布渠道在准备实际发布时配置；不要将私钥或凭据提交到源码。

## Agent 能力与安装包的区别

Ailo 安装成功不意味着 Android 开发工具链已经可用。Android 构建需要适配的 JDK、SDK 等，模拟器还涉及镜像与硬件资源。后续应提供能力检测与引导安装，或接入已配置的远程执行环境，不能要求每位普通使用者手动复制开发者环境。

本地任务在电脑离线或应用执行进程关闭时不能继续；云端任务可独立继续。后台进程、系统睡眠以及任务恢复策略需要专门实现并测试。

## 发布验收

- 干净 Mac 下载、安装、首次启动成功，无需开发工具即可使用基础助手功能。
- 正式包通过签名与公证验证。
- 不包含个人 API 密钥、私有开发路径或测试账号。
- 数据写入用户应用数据目录，与安装目录分离。
- 断网、重启、升级后会话和任务状态可恢复，副作用不重复执行。
- 版本与架构可识别；下载、更新失败有可操作提示。
- Android 能力缺少工具链时准确提示，不假报构建或预览成功。

## 官方参考

- https://www.electronjs.org/docs/latest/tutorial/distribution-overview
- https://www.electronjs.org/docs/latest/tutorial/tutorial-packaging
- https://developer.apple.com/documentation/xcode/packaging-mac-software-for-distribution
