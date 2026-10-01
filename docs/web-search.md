# 联网搜索（0.1.60）

入口：扩展 → 应用连接 → 联网搜索。默认选择百度，也可选择 Tavily。填写对应服务的 API Key，设置本机调用上限，点击“保存并测试”。保存与检测分离：检测成功才显示绿点，检测本身消耗一次请求。密钥通过 Electron safeStorage 加密，不进入模型上下文或渲染进程状态响应。

开启使用：输入框 ＋ → 应用连接 → 联网搜索开关。开关按对话保存，发送时取快照；执行中的开关变更用于下次请求。关闭不会删除凭据。联网问答无需项目或任务计划。执行中显示搜索关键词，答案追加本轮真实返回的来源链接，来源链接可从历史消息中打开。

百度使用 https://qianfan.baidubce.com/v2/ai_search/web_search，search_source=baidu_search_v2。Tavily 使用 https://api.tavily.com/search，固定 basic、关闭自动参数与答案生成。仅获取搜索结果及摘要，此版本不提供任意网页抓取。

默认本机限额：百度每日 100 次（北京时间）；Tavily 每月 1000 次（UTC）。官方额度与计费以服务商账号为准。本机统计包含测试、失败尝试，不统计其他设备/应用，也不包含模型费用。计数在请求前串行持久化，防止并发超发；切换提供商保留计数。不自动切换服务或开通付费。每轮最多 3 次搜索，20 秒超时、1 MB 响应上限、5 条结果，摘要每条最多 1600 字符；只允许固定服务端点、禁止重定向。网页结果是参考数据，不能作为执行指令。

验证：8 项新增回归覆盖请求格式、凭据不进入结果、链接过滤、配额并发/跨重启/跨服务商、取消、响应上限、普通聊天搜索与关闭状态；独立 Electron 测试覆盖配置、连接状态、开关及历史来源链接。未使用用户密钥进行真实服务端验证。

官方参考：
- 百度：https://ai.baidu.com/ai-doc/AppBuilder/pmaxd1hvy
- Tavily：https://docs.tavily.com/documentation/api-reference/endpoint/search
- Tavily 额度：https://www.tavily.com/pricing
