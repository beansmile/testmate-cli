"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  ApiError,
  apiUrlForVersion,
  createClient,
  loadConnection,
  parseFeedbackReference,
} = require("../lib/api");

function fakeFetch(responses) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    const next = responses.shift();
    return new Response(next.body === undefined ? "" : JSON.stringify(next.body), { status: next.status || 200 });
  };
  return { calls, fetchImpl };
}

test("parseFeedbackReference accepts handle/FB-n and rejects the rest", () => {
  assert.deepEqual(parseFeedbackReference("demo/FB-12"), { handle: "demo", number: "12" });
  for (const bad of ["FB-12", "demo/fb-12", "demo/FB-0", "Demo/FB-1", "ab/FB-1", "ab--c/FB-1", ""]) {
    assert.throws(() => parseFeedbackReference(bad), /handle>\/FB-<number>/, bad);
  }
});

test("apiUrlForVersion swaps the trailing /v1", () => {
  assert.equal(apiUrlForVersion("http://localhost:3000/api/v1", "v2"), "http://localhost:3000/api/v2");
  assert.throws(() => apiUrlForVersion("http://localhost:3000/api", "v2"), /must end in \/v1/);
});

test("verifyFeedback posts the verification body to the v2 endpoint", async () => {
  const { calls, fetchImpl } = fakeFetch([{ body: { reference: "demo/FB-7", status: "closed", close_reason: "shipped" } }]);
  const client = createClient({ apiUrl: "http://x.test/api/v1", token: "token_abc", accountId: "acct_1", fetchImpl });
  const result = await client.verifyFeedback("demo/FB-7", { outcome: "passed", note: "ok", evidence_url: "https://ci.test/1" });
  assert.equal(result.status, "closed");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "http://x.test/api/v2/projects/demo/feedbacks/7/verification?account_id=acct_1");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.headers.Authorization, "Bearer token_abc");
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    feedback_verification: { outcome: "passed", note: "ok", evidence_url: "https://ci.test/1" },
  });
});

test("getFeedback reads from v1 without account_id when none is configured", async () => {
  const { calls, fetchImpl } = fakeFetch([{ body: { reference: "demo/FB-3", status: "pending_verification" } }]);
  const client = createClient({ apiUrl: "http://x.test/api/v1", token: "t", fetchImpl });
  const result = await client.getFeedback("demo/FB-3");
  assert.equal(result.status, "pending_verification");
  assert.equal(calls[0].url, "http://x.test/api/v1/projects/demo/feedbacks/3");
});

test("API errors keep the server message, status and code", async () => {
  const { fetchImpl } = fakeFetch([
    { status: 409, body: { error: "Feedback must be pending_verification to verify it (is in_progress).", code: "invalid_transition" } },
    { status: 422 },
    { status: 401, body: { error: "Unauthorized" } },
  ]);
  const client = createClient({ apiUrl: "http://x.test/api/v1", token: "t", fetchImpl });

  const conflict = await client.verifyFeedback("demo/FB-1", { outcome: "passed" }).catch((e) => e);
  assert.ok(conflict instanceof ApiError);
  assert.equal(conflict.status, 409);
  assert.equal(conflict.code, "invalid_transition");
  assert.match(conflict.message, /must be pending_verification/);

  const invalid = await client.verifyFeedback("demo/FB-1", { outcome: "failed" }).catch((e) => e);
  assert.equal(invalid.status, 422);
  assert.match(invalid.message, /rejected the request as invalid/);

  const unauthorized = await client.getFeedback("demo/FB-1").catch((e) => e);
  assert.match(unauthorized.message, /testmate login --token/);
});

test("loadConnection reads the config and applies MTB_* overrides", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "testmate-cli-"));
  const file = path.join(dir, "config.json");
  fs.writeFileSync(file, JSON.stringify({ api_token: "token_file", api_url: "http://a.test/api/v1/", account_id: "acct_9" }));

  assert.deepEqual(loadConnection(file, {}), { token: "token_file", apiUrl: "http://a.test/api/v1", accountId: "acct_9" });
  assert.deepEqual(
    loadConnection(file, { MTB_API_TOKEN: "token_env", MTB_API_URL: "http://b.test/api/v1" }),
    { token: "token_env", apiUrl: "http://b.test/api/v1", accountId: "acct_9" }
  );
  assert.throws(() => loadConnection(path.join(dir, "missing.json"), {}), /not logged in/);
  assert.deepEqual(
    loadConnection(path.join(dir, "missing.json"), { MTB_API_TOKEN: "token_ci" }),
    { token: "token_ci", apiUrl: "https://testmate.beansmile.ai/api/v1", accountId: undefined }
  );
});
