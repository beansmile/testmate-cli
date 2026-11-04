"use strict";
// Runs bin/testmate.js as a child process against a fake TestMate API.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { injectFeedbackCommands } = require("../lib/help");

const BIN = path.join(__dirname, "..", "bin", "testmate.js");

function run(args, env) {
  return new Promise((resolve) => {
    execFile(process.execPath, [BIN, ...args], { env }, (error, stdout, stderr) => {
      resolve({ code: error ? error.code : 0, stdout, stderr });
    });
  });
}

async function fakeServer(handler) {
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      const request = { method: req.method, url: req.url, auth: req.headers.authorization, body: body ? JSON.parse(body) : null };
      requests.push(request);
      const { status, json } = handler(request);
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(json));
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { requests, url: "http://127.0.0.1:" + server.address().port, close: () => new Promise((r) => server.close(r)) };
}

function configEnv(apiUrl) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "testmate-cli-"));
  const file = path.join(dir, "config.json");
  fs.writeFileSync(file, JSON.stringify({ api_token: "token_test", api_url: apiUrl + "/api/v1", account_id: "acct_1" }));
  const env = { ...process.env, MAKETHISBETTER_CONFIG: file, NO_COLOR: "1" };
  delete env.MTB_API_TOKEN;
  delete env.MTB_API_URL;
  delete env.TESTMATE_API_TOKEN;
  return env;
}

test("feedback verify and reject call the v2 verification endpoint", async () => {
  const server = await fakeServer(({ body }) => {
    const outcome = body.feedback_verification.outcome;
    return outcome === "passed"
      ? { status: 200, json: { reference: "demo/FB-8", status: "closed", close_reason: "shipped" } }
      : { status: 200, json: { reference: "demo/FB-8", status: "in_progress", assignee: { id: "user_1", name: "Admin" } } };
  });
  try {
    const env = configEnv(server.url);
    const verified = await run(["feedback", "verify", "demo/FB-8", "--note", "ok", "--evidence", "https://ci.test/1"], env);
    assert.equal(verified.code, 0, verified.stderr);
    assert.match(verified.stdout, /passed verification and is closed \(shipped\)/);

    const rejected = await run(["feedback", "reject", "demo/FB-8", "--note", "still broken", "--json"], env);
    assert.equal(rejected.code, 0, rejected.stderr);
    assert.equal(JSON.parse(rejected.stdout).status, "in_progress");

    assert.deepEqual(
      server.requests.map((r) => [r.method, r.url, r.auth, r.body]),
      [
        ["POST", "/api/v2/projects/demo/feedbacks/8/verification?account_id=acct_1", "Bearer token_test",
          { feedback_verification: { outcome: "passed", note: "ok", evidence_url: "https://ci.test/1" } }],
        ["POST", "/api/v2/projects/demo/feedbacks/8/verification?account_id=acct_1", "Bearer token_test",
          { feedback_verification: { outcome: "failed", note: "still broken" } }],
      ]
    );
  } finally {
    await server.close();
  }
});

test("feedback verify surfaces the server's 409 and exits 1", async () => {
  const server = await fakeServer(() => ({
    status: 409,
    json: { error: "Feedback must be pending_verification to verify it (is received).", code: "invalid_transition" },
  }));
  try {
    const res = await run(["feedback", "verify", "demo/FB-8"], configEnv(server.url));
    assert.equal(res.code, 1);
    assert.equal(res.stdout, "");
    assert.match(res.stderr, /Error: verifying feedback: Feedback must be pending_verification to verify it \(is received\)\./);
  } finally {
    await server.close();
  }
});

test("feedback reject without --note fails before any request", async () => {
  const server = await fakeServer(() => ({ status: 500, json: {} }));
  try {
    const res = await run(["feedback", "reject", "demo/FB-8"], configEnv(server.url));
    assert.equal(res.code, 1);
    assert.match(res.stderr, /--note is required/);
    assert.equal(server.requests.length, 0);
  } finally {
    await server.close();
  }
});

test("injectFeedbackCommands slots verify and reject into cobra's command list", () => {
  const help = [
    "Manage feedback",
    "",
    "Available Commands:",
    "  archive     Archive one unclaimed feedback",
    "  ready       Mark implemented feedback ready for release",
    "  release     Release feedback included in a deployed Git revision",
    "  show        Show feedback details",
    "",
    "Flags:",
    "  -h, --help   help for feedback",
    "",
  ].join("\n");
  const out = injectFeedbackCommands(help);
  const names = out.split("\n").filter((l) => /^ {2}\w/.test(l) && !l.includes("--help")).map((l) => l.trim().split(/\s+/)[0]);
  assert.deepEqual(names, ["archive", "ready", "reject", "release", "show", "verify"]);
  assert.match(out, /\n {2}verify {6}Pass QA verification/);
  assert.match(out, /\n\nFlags:\n/);
  assert.equal(injectFeedbackCommands("no command list here"), "no command list here");
});
