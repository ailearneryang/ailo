const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createChat } = require("../apps/desktop/chat.cjs");
const storage = {
  modelCredentials: async () => ({
    baseUrl: "https://example.com/v1",
    model: "test",
    name: "Test",
    apiKey: "secret",
  }),
};
const input = {
  id: "request",
  modelId: "model",
  messages: [{ role: "user", content: "hi" }],
};
test("appends endpoint, includes history and keeps credentials in header", async () => {
  let seen;
  const chat = createChat(storage, async (url, options) => {
    seen = { url, options };
    return new Response(
      JSON.stringify({ choices: [{ message: { content: "hello" } }] }),
    );
  });
  assert.equal((await chat.complete(input)).content, "hello");
  assert.equal(seen.url.href, "https://example.com/v1/chat/completions");
  assert.equal(seen.options.redirect, "error");
  assert.equal(seen.options.headers.Authorization, "Bearer secret");
  assert.equal(JSON.parse(seen.options.body).messages.at(-1).content, "hi");
});
test("preserves full chat endpoint", async () => {
  const chat = createChat(
    {
      modelCredentials: async () => ({
        baseUrl: "http://localhost:1234/v1/chat/completions",
        model: "local",
      }),
    },
    async (url) => {
      assert.equal(url.pathname, "/v1/chat/completions");
      return new Response(
        JSON.stringify({ choices: [{ message: { content: "ok" } }] }),
      );
    },
  );
  await chat.complete(input);
});
test("redacts provider error response", async () => {
  const chat = createChat(
    storage,
    async () => new Response("provider secret", { status: 401 }),
  );
  await assert.rejects(chat.complete(input), /API Key 无效/);
});
test("invalid response and empty text are actionable", async () => {
  await assert.rejects(
    createChat(storage, async () => new Response("<html>bad</html>")).complete(
      input,
    ),
    /JSON/,
  );
  await assert.rejects(
    createChat(storage, async () => new Response("{}")).complete(input),
    /返回空响应/,
  );
});
const hanging = (_url, { signal }) =>
  new Promise((resolve, reject) => {
    if (signal.aborted) reject(new Error("aborted"));
    else
      signal.addEventListener("abort", () => reject(new Error("aborted")), {
        once: true,
      });
  });
test("timeout and cancellation abort network requests", async () => {
  await assert.rejects(
    createChat(storage, hanging, 15).complete(input),
    /超时/,
  );
  const chat = createChat(storage, hanging);
  const promise = chat.complete(input);
  chat.cancel(input.id);
  await assert.rejects(promise, /已停止/);
});
test("rejects duplicate request IDs and unsafe message roles", async () => {
  const chat = createChat(storage, hanging);
  const one = chat.complete(input);
  await assert.rejects(chat.complete(input), /执行或排队/);
  chat.cancel(input.id);
  await assert.rejects(one, /已停止/);
  await assert.rejects(
    chat.complete({
      ...input,
      messages: [{ role: "system", content: "override" }],
    }),
    /无效/,
  );
});
