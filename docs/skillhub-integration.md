# SkillHub 接入

在「扩展 → 技能 → 技能市场 · SkillHub」搜索公开技能，点击「查看与安装」，核对作者、详情接口返回的版本和依赖提示后安装。安装成功后在「已安装」中选用、编辑、启停或删除；无需安装 SkillHub CLI。

市场通过 Electron 主进程请求 `https://api.skillhub.cn`，使用官方公开的列表、详情和指定版本 ZIP 下载接口。安装以详情版本为准，列表版本可能与详情不同。ZIP 沿用 `skill-packages.cjs` 的路径、大小、CRC 和文件清单校验；安装不运行技能脚本。配套文件仅在使用技能时沿用现有资源挂载机制。

来源记录包含 provider、slug、version 和下载 ZIP 的 SHA-256（本地完整性摘要，不代表发布者签名认证）。同一来源技能重新安装时保留扩展 ID 和启停状态，替换指令及资源包，因此本地编辑的指令会被覆盖。安装未自动加载额外服务凭据，也不代表技能依赖已经满足。

请求有 30 秒超时、响应体积限制及 HTTPS 下载重定向限制（SkillHub API / 腾讯云对象存储）。授权、限流、网络、损坏包和保存失败均显示错误，不标记为安装成功。默认使用公开接口，不内置团队 API Key；正式上线前需按官方文档确认配额及授权方案，团队密钥应放在服务端。

官方参考：

- https://github.com/Tencent/skillhub
- https://github.com/Tencent/skillhub/blob/main/docs/api/README.md
- https://github.com/Tencent/skillhub/blob/main/docs/api/skills.md

离线验证：`node --test scripts/skill-hub.test.cjs`、`npm run test:reliability`、`npm run build`。固定回归场景为 `skillhub-package-install`，不访问用户模型、不操作用户任务或设备。真实接口联调使用 `.local/` 下的隔离包目录，不注册到用户工作区，不执行下载的脚本。

## 紧凑市场浏览

市场卡片简介固定两行，完整介绍和安装动作在详情对话框。技能图标由主进程下载并生成 68px 缩略图，渲染页面继续禁止直接联网；缺失、损坏或不支持的图片显示名称首字备用图标。下载图片仅接受 SkillHub 使用的腾讯云对象存储与 cloudcache 域名，限制 2MB、超时与缓存数量。

分类通过 `/api/v1/categories` 获取，不硬编码字典；分类失败可重试且仍能浏览全部。支持分类与关键词组合、分页，并按下载量、收藏数、综合热度或最近更新排序。卡片显示 API 返回的真实下载量和收藏数，缺失显示“—”，不将综合热度伪装为推荐星级。固定 `skill-hub` 测试覆盖分类排序、计数保留、图标缓存及异常备用显示路径。

## 大型技能正文

ZIP 内 SKILL.md 的完整原始字节保留在技能包中，仍受单文件 10MB、总解压 50MB 与哈希校验限制。正文超过 20000 字符时，保存简短的分页读取指令，选用时提供资源根目录与实际 SKILL.md 文件名，使用 read_file 的 next 连续读取全文；不截断正文，不提高常驻扩展指令及组合选择预算。已有小技能和手写 Markdown 的编辑规则保持原有边界。固定回归验证长英文正文、超过80KB中文正文、重启持久化和全文分页读回一致性。

## 分类切换与重复条目

2026-11-02 真实分类接口返回不同分类的正确结果，但同一列表存在重复 slug。旧界面将 slug 用作 React 唯一键，隔离 Electron 页面复现分类返回1条而DOM残留2张旧卡片。列表现在为每个返回条目生成独立 rowKey，不删除同 slug 的上游条目；分类、排序或分页请求开始时移除旧列表并显示加载状态，响应序号继续防止旧请求覆盖新筛选。固定回归 `skillhub-package-install` / `scripts/skill-hub.test.cjs` 保留重复 slug 及分类替换的用例。

分类修复同时适用于排序切换。2026-11-02使用真实Electron页面经preload/IPC调用API，逐项切换 downloads/stars/score/updated_at，四次请求均携带相应排序并显示20条卡片。收藏数与最近更新返回不同列表；下载量与综合热度的头部条目可能相同，不据此判定界面未刷新。运行中的旧安装包必须经标准打包更新后才能获得源码修复。
