"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { ApiError } = require("../lib/api");
const { buildVerification, runVerification } = require("../lib/verification");

function sink() {
  let text = "";
  return { write: (s) => { text += s; }, get text() { return text; } };
}

function fakeClient(result) {
  const calls = [];
  return {
    calls,
    async verifyFeedback(reference, verification) {
      calls.push({ reference, verification });
      if (result instanceof Error) throw result;
      return result;
    },
  };
}

test("verify builds a passed outcome with optional note and evidence", () => {
  assert.deepEqual(buildVerification("verify", ["demo/FB-4"]), {
    reference: "demo/FB-4",
    verification: { outcome: "passed" },
    json: false,
  });
  assert.deepEqual(
    buildVerification("verify", ["demo/FB-4", "--note", "  checked on Safari  ", "--evidence=https://ci.test/run/9", "--json"]),
    {
      reference: "demo/FB-4",
      verification: { outcome: "passed", note: "checked on Safari", evidence_url: "https://ci.test/run/9" },
      json: true,
    }
  );
});

test("reject requires a note and sends a failed outcome", () => {
  assert.throws(() => buildVerification("reject", ["demo/FB-4"]), /--note is required/);
  assert.throws(() => buildVerification("reject", ["demo/FB-4", "--note", "   "]), /--note is required/);
  assert.deepEqual(buildVerification("reject", ["--note", "still broken on iOS", "demo/FB-4"]), {
    reference: "demo/FB-4",
    verification: { outcome: "failed", note: "still broken on iOS" },
    json: false,
  });
});

test("argument validation mirrors the server rules", () => {
  assert.throws(() => buildVerification("verify", []), /accepts 1 arg/);
  assert.throws(() => buildVerification("verify", ["demo/FB-1", "demo/FB-2"]), /accepts 1 arg/);
  assert.throws(() => buildVerification("verify", ["FB-1"]), /handle>\/FB-<number>/);
  assert.throws(() => buildVerification("verify", ["demo/FB-1", "--evidence", "ftp://x"]), /http\(s\) URL/);
  assert.throws(() => buildVerification("verify", ["demo/FB-1", "--note", "x".repeat(2001)]), /at most 2000/);
  assert.throws(() => buildVerification("verify", ["demo/FB-1", "--bogus"]), /unknown flag: --bogus/);
  assert.throws(() => buildVerification("verify", ["demo/FB-1", "--note"]), /needs an argument/);
  assert.deepEqual(buildVerification("reject", ["-h"]), { help: true });
});

test("runVerification prints a passed result", async () => {
  const client = fakeClient({ reference: "demo/FB-4", status: "closed", close_reason: "shipped", title: "Export fails" });
  const stdout = sink();
  const stderr = sink();
  const code = await runVerification("verify", ["demo/FB-4"], { client, stdout, stderr });
  assert.equal(code, 0);
  assert.equal(stderr.text, "");
  assert.match(stdout.text, /^\* Feedback demo\/FB-4 passed verification and is closed \(shipped\)\./);
  assert.match(stdout.text, /Title: Export fails/);
  assert.deepEqual(client.calls, [{ reference: "demo/FB-4", verification: { outcome: "passed" } }]);
});

test("runVerification prints a rejected result with the assignee and next step", async () => {
  const client = fakeClient({ reference: "demo/FB-4", status: "in_progress", assignee: { id: "user_1", name: "Devon" } });
  const stdout = sink();
  const code = await runVerification("reject", ["demo/FB-4", "--note", "still 500s"], { client, stdout, stderr: sink() });
  assert.equal(code, 0);
  assert.match(stdout.text, /failed verification and is back in progress \(assignee: Devon\)/);
  assert.match(stdout.text, /testmate feedback ready demo\/FB-4/);
  assert.deepEqual(client.calls[0].verification, { outcome: "failed", note: "still 500s" });
});

test("runVerification --json prints the bare Feedback", async () => {
  const feedback = { reference: "demo/FB-4", status: "closed", close_reason: "shipped" };
  const stdout = sink();
  const code = await runVerification("verify", ["demo/FB-4", "--json"], { client: fakeClient(feedback), stdout, stderr: sink() });
  assert.equal(code, 0);
  assert.deepEqual(JSON.parse(stdout.text), feedback);
});

test("runVerification reports API errors and usage errors without calling twice", async () => {
  const conflict = new ApiError(409, "Feedback must be pending_verification to verify it (is in_progress).", { code: "invalid_transition" });
  const stderr = sink();
  const code = await runVerification("verify", ["demo/FB-4"], { client: fakeClient(conflict), stdout: sink(), stderr });
  assert.equal(code, 1);
  assert.match(stderr.text, /^Error: verifying feedback: Feedback must be pending_verification/);
  assert.match(stderr.text, /testmate feedback show demo\/FB-4/);

  const client = fakeClient({});
  const usage = sink();
  assert.equal(await runVerification("reject", ["demo/FB-4"], { client, stdout: sink(), stderr: usage }), 1);
  assert.match(usage.text, /--note is required/);
  assert.equal(client.calls.length, 0);
});

test("runVerification creates the client lazily, so --help needs no login", async () => {
  const stdout = sink();
  const code = await runVerification("verify", ["--help"], {
    client: () => { throw new Error("should not be called"); },
    stdout,
    stderr: sink(),
  });
  assert.equal(code, 0);
  assert.match(stdout.text, /testmate feedback verify <handle\/FB-n>/);
});
