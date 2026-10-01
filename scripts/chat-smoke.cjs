const { _electron: electron } = require(
  process.env.PLAYWRIGHT_MODULE || "playwright",
);
const fs = require("node:fs/promises");
const path = require("node:path");
const http = require("node:http");
const assert = require("node:assert/strict");
const root = path.resolve(__dirname, "..");
(async () => {
  const requests = [];
  let behavior = "ok";
  const server = http.createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    requests.push({
      body,
      url: req.url,
      authorization: req.headers.authorization,
    });
    if (behavior === "wait") {
      req.on("close", () => res.destroy());
      return;
    }
    if (behavior === "unauthorized") {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "do-not-display-server-secret" }));
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        choices: [
          {
            message: {
              content:
                body.messages.filter((m) => m.role === "user").length === 1
                  ? "你好！有什么我可以帮你的吗？"
                  : "记得，你刚才向我问好了。",
            },
          },
        ],
      }),
    );
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const dir = await fs.mkdtemp(path.join(root, ".local/chat-smoke-"));
  const project = { id: "project", name: "聊天测试" };
  await fs.writeFile(
    path.join(dir, "workspace.json"),
    JSON.stringify({
      projects: [project],
      models: [],
      defaultModelId: "demo",
      tasks: [
        {
          id: "legacy",
          title: "旧版 hi",
          request: "hi",
          projectId: "project",
          materials: [],
          created: new Date().toISOString(),
          answer: "需求文档与方案",
        },
      ],
    }),
  );
  const options = {
    executablePath: require(
      path.join(root, "apps/desktop/node_modules/electron"),
    ),
    args: [path.join(root, "apps/desktop")],
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: undefined,
      AILO_DATA_DIR: dir,
    },
  };
  let app;
  const errors = [];
  try {
    app = await electron.launch(options);
    let page = await app.firstWindow();
    page.on("pageerror", (e) => errors.push(e.message));
    await page.getByText("本地记录已就绪").waitFor();
    await page.getByRole("button", { name: "旧版 hi", exact: true }).click();
    assert.equal(await page.getByText("这次你希望拿到什么？").count(), 0);
    await page.getByRole("button", { name: "发送给模型", exact: true }).click();
    await page
      .getByText("请先在输入框右下角配置或选择模型，再发送消息。", {
        exact: false,
      })
      .waitFor();
    assert.equal(requests.length, 0);
    await page.getByRole("button", { name: /^选择模型：/ }).click();
    await page
      .getByRole("dialog", { name: "选择模型", exact: true })
      .getByRole("button", { name: "配置自定义模型", exact: true })
      .click();
    await page
      .getByRole("button", { name: "＋ 添加模型", exact: true })
      .click();
    await page.getByLabel("显示名称", { exact: true }).fill("本地测试模型");
    await page.getByLabel("模型 ID", { exact: true }).fill("test-chat-model");
    await page
      .getByLabel("API 地址", { exact: true })
      .fill(`http://127.0.0.1:${server.address().port}/v1`);
    await page.getByLabel("API Key", { exact: false }).fill("test-key-123");
    await page.getByRole("button", { name: "保存模型", exact: true }).click();
    await page.getByText("模型配置已保存，返回对话即可使用。").waitFor();
    await page.getByRole("button", { name: "← 返回对话", exact: true }).click();
    await page.getByRole("button", { name: "发送给模型", exact: true }).click();
    await page
      .getByText("你好！有什么我可以帮你的吗？", { exact: true })
      .waitFor();
    assert.equal(requests[0].url, "/v1/chat/completions");
    assert.equal(requests[0].authorization, "Bearer test-key-123");
    assert.equal(requests[0].body.model, "test-chat-model");
    assert.equal(requests[0].body.messages.at(-1).content, "hi");
    assert.equal(await page.getByText("这次你希望拿到什么？").count(), 0);
    assert.equal(await page.locator(".inspector").count(), 0);
    await page
      .getByRole("textbox", { name: "任务需求" })
      .fill("你还记得我刚才说了什么吗？");
    await page.getByRole("textbox", { name: "任务需求" }).press("Enter");
    await page.getByText("记得，你刚才向我问好了。", { exact: true }).waitFor();
    assert.deepEqual(
      requests[1].body.messages.map((m) => m.role),
      ["system", "user", "assistant", "user"],
    );
    await page.screenshot({
      path: path.join(root, ".local/real-chat-preview.png"),
    });
    const before = await page.evaluate(() => window.ailo.read());
    assert.equal(before.tasks[0].messages.length, 4);
    await app.close();
    app = await electron.launch(options);
    page = await app.firstWindow();
    page.on("pageerror", (e) => errors.push(e.message));
    await page.getByText("本地记录已就绪").waitFor();
    await page.getByRole("button", { name: "旧版 hi", exact: true }).click();
    await page.getByText("记得，你刚才向我问好了。", { exact: true }).waitFor();
    assert.deepEqual(await page.evaluate(() => window.ailo.read()), before);
    behavior = "unauthorized";
    await page.getByRole("textbox", { name: "任务需求" }).fill("检查错误提示");
    await page.getByRole("button", { name: "发送需求" }).click();
    await page
      .getByText("API Key 无效或已过期，请检查模型配置。", { exact: true })
      .waitFor();
    assert.equal(
      await page.getByText("do-not-display-server-secret").count(),
      0,
    );
    const failed = await page.evaluate(() => window.ailo.read());
    assert.equal(failed.tasks[0].messages.length, 5);
    behavior = "ok";
    await page.getByRole("button", { name: "重试回复", exact: true }).click();
    await page.getByRole("button", { name: "发送需求" }).waitFor();
    assert.equal(
      (await page.evaluate(() => window.ailo.read())).tasks[0].messages.length,
      6,
    );
    behavior = "wait";
    await page.getByRole("textbox", { name: "任务需求" }).fill("慢速请求");
    await page.getByRole("button", { name: "发送需求" }).click();
    await page.getByRole("button", { name: "停止回复" }).click();
    await page.getByText("已停止回复，可重新发送。", { exact: true }).waitFor();
    // A fresh greeting produces a chat turn, never the old fixed questionnaire.
    behavior = "ok";
    await page
      .getByRole("button", { name: "新的对话", exact: true })
      .click();
    await page.getByRole("textbox", { name: "任务需求" }).fill("hi");
    await page.getByRole("button", { name: "发送需求" }).click();
    await page
      .getByText("你好！有什么我可以帮你的吗？", { exact: true })
      .waitFor();
    assert.equal(await page.getByText("这次你希望拿到什么？").count(), 0);
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setSize(760, 600),
    );
    await page.screenshot({
      path: path.join(root, ".local/real-chat-compact.png"),
    });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    assert.equal(
      await page
        .getByRole("button", { name: "发送需求" })
        .evaluate((el) => el.getBoundingClientRect().bottom <= innerHeight),
      true,
    );
    assert.deepEqual(errors, []);
    console.log(
      "PASS: no-model guidance, legacy hi recovery, real HTTP request/auth, greeting without questionnaire, multi-turn context, restart, API errors without leaked body, retry without duplicate, stop, new chat, compact layout.",
    );
  } finally {
    if (app) await app.close();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
