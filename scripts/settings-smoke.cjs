const { _electron: electron } = require(
  process.env.PLAYWRIGHT_MODULE || "playwright",
);
const fs = require("node:fs/promises"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const root = path.resolve(__dirname, "..");
(async () => {
  const dir = await fs.mkdtemp(path.join(root, ".local/settings-smoke-"));
  const options = {
    executablePath: process.env.AILO_EXECUTABLE || require(
      path.join(root, "apps/desktop/node_modules/electron"),
    ),
    args: process.env.AILO_EXECUTABLE ? [] : [path.join(root, "apps/desktop")],
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: undefined,
      AILO_DATA_DIR: dir,
    },
  };
  let app;
  try {
    app = await electron.launch(options);
    let page = await app.firstWindow();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.getByText("本地记录已就绪").waitFor();
    await page.getByRole("textbox", { name: "任务需求" }).fill("保留这段草稿");
    await page.getByRole("button", { name: "选择项目", exact: true }).click();
    await page.getByRole("button", { name: "新建项目", exact: true }).click();
    await page.getByLabel("项目名称", { exact: true }).fill("Ailo");
    await page.getByRole("button", { name: "创建项目", exact: true }).click();
    await page
      .getByRole("button", { name: "选择项目：Ailo", exact: true })
      .waitFor();
    await page.getByRole("button", { name: /^选择项目/ }).click();
    await page.getByRole("textbox", { name: "搜索项目" }).fill("没有这个项目");
    await page.getByText("没有找到匹配的项目").waitFor();
    await page.getByRole("textbox", { name: "搜索项目" }).fill("Ailo");
    await page.getByRole("button", { name: "新建项目", exact: true }).click();
    await page.getByRole("button", { name: "创建项目", exact: true }).click();
    await page
      .getByText("这个项目名称已存在，请选择已有项目或换个名称。")
      .waitFor();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: /^选择模型：/ }).click();
    await page
      .getByRole("button", { name: "配置自定义模型", exact: true })
      .click();
    await page
      .getByRole("button", { name: "＋ 添加模型", exact: true })
      .click();
    await page.getByLabel("显示名称", { exact: true }).fill("测试模型");
    await page.getByLabel("模型 ID", { exact: true }).fill("test-model");
    await page.getByRole("spinbutton", {name:/^上下文容量/}).fill("100000");
    await page.getByRole("spinbutton", {name:/^单次最大输出额度/}).fill("20000");
    await page
      .getByLabel("API 地址", { exact: true })
      .fill("http://example.com/v1");
    await page.getByRole("button", { name: "保存模型", exact: true }).click();
    await page.getByText("请使用 HTTPS 地址", { exact: false }).waitFor();
    await page
      .getByLabel("API 地址", { exact: true })
      .fill("https://example.com/v1");
    await page
      .getByLabel("API Key", { exact: false })
      .fill("test-key-never-plaintext");
    await page.getByRole("button", { name: "保存模型", exact: true }).click();
    await page.getByText("模型配置已保存，返回对话即可使用。").waitFor();
    assert.equal(
      (await fs.readFile(path.join(dir, "workspace.json"), "utf8")).includes(
        "test-key-never-plaintext",
      ),
      false,
    );
    await page
      .getByRole("button", { name: "编辑 测试模型", exact: true })
      .click();
    assert.equal(await page.getByRole("spinbutton", {name:/^单次最大输出额度/}).inputValue(),"20000");
    await page.screenshot({path:path.join(root,".local/output-settings.png"),fullPage:true});
    await page.getByLabel("显示名称", { exact: true }).fill("工作模型");
    await page.getByRole("button", { name: "保存模型", exact: true }).click();
    await page.getByText("模型配置已保存，返回对话即可使用。").waitFor();
    const state = await page.evaluate(() => window.ailo.read());
    assert.equal(state.models[0].hasKey, true);
    assert.equal(state.models[0].contextWindow,100000);
    assert.equal(state.models[0].maxOutputTokens,20000);
    assert.equal(state.models[0].apiKey, undefined);
    assert.equal(state.models[0].encryptedKey, undefined);
    assert.equal(state.defaultModelId, state.models[0].id);
    await page.getByRole("button", { name: "← 返回对话", exact: true }).click();
    assert.equal(
      await page.getByRole("textbox", { name: "任务需求" }).inputValue(),
      "保留这段草稿",
    );
    await page
      .getByRole("button", { name: "选择模型：工作模型", exact: true })
      .waitFor();
    await page.getByRole("button", { name: /^选择模型：/ }).click();
    await page.getByRole("textbox", { name: "搜索模型" }).fill("test-model");
    await page
      .getByRole("dialog", { name: "选择模型", exact: true })
      .getByRole("button", { name: "工作模型", exact: true })
      .click();
    await page.getByRole("button", { name: "登录或注册", exact: true }).click();
    await page.getByRole("button", { name: "注册", exact: true }).click();
    await page.getByLabel("昵称", { exact: true }).fill("测试用户");
    await page.getByLabel("邮箱", { exact: true }).fill("test@example.com");
    await page.getByLabel("密码", { exact: true }).fill("test-password-123");
    await page
      .getByRole("button", { name: "创建账号并登录", exact: true })
      .click();
    await page.getByRole("heading", { name: "你好，测试用户" }).waitFor();
    assert.equal(
      (await fs.readFile(path.join(dir, "accounts.json"), "utf8")).includes(
        "test-password-123",
      ),
      false,
    );
    await page.getByRole("button", { name: "退出登录", exact: true }).click();
    await page.getByRole("button", { name: "登录", exact: true }).click();
    await page.getByLabel("邮箱", { exact: true }).fill("test@example.com");
    await page.getByLabel("密码", { exact: true }).fill("wrong-password");
    await page.getByRole("button", { name: "登录 Ailo", exact: true }).click();
    await page
      .getByText("邮箱或密码不正确。请确认已在这台电脑注册。")
      .waitFor();
    await page.getByLabel("密码", { exact: true }).fill("test-password-123");
    await page.getByRole("button", { name: "登录 Ailo", exact: true }).click();
    await page.getByRole("heading", { name: "你好，测试用户" }).waitFor();
    await app.close();
    app = await electron.launch(options);
    page = await app.firstWindow();
    await page
      .getByRole("button", { name: "查看用户信息", exact: true })
      .waitFor();
    assert.deepEqual(await page.evaluate(() => window.ailo.read()), state);
    await page.getByRole("button", { name: /^选择模型：/ }).click();
    await page
      .getByRole("button", { name: "配置自定义模型", exact: true })
      .click();
    await page
      .getByRole("button", { name: "移除 工作模型", exact: true })
      .click();
    await page.getByRole("button", { name: "确认移除", exact: true }).click();
    await page.getByText("模型已移除，已有对话保留原模型名称。").waitFor();
    assert.equal(
      (await page.evaluate(() => window.ailo.read())).models.length,
      0,
    );
    assert.deepEqual(errors, []);
    console.log(
      "PASS: project create/search/duplicate; model add/edit/remove/search/default; encrypted key retention; draft retention; account register/login/logout/restart.",
    );
  } finally {
    if (app) await app.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
