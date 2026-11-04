"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { runRelease } = require("../lib/release");

function sink() {
  let text = "";
  return { write: (s) => { text += s; }, get text() { return text; } };
}

function binary(result, status = 0) {
  const calls = [];
  const runBinary = (args) => {
    calls.push(args);
    return { status, signal: null, stdout: typeof result === "string" ? result : JSON.stringify(result, null, 2) + "\n" };
  };
  return { calls, runBinary };
}

function statuses(map) {
  return {
    async getFeedback(reference) {
      const value = map[reference];
      if (value instanceof Error) throw value;
      return { reference, status: value };
    },
  };
}

const ARGS = ["feedback", "release", "--project", "demo", "--through", "abc123"];

test("text output splits released Feedback into closed and Verifying", async () => {
  const { calls, runBinary } = binary({
    released: ["demo/FB-1", "demo/FB-2", "demo/FB-3"],
    skipped: [{ reference: "demo/FB-9", reason: "not_pending_release" }],
    failures: [],
  });
  const stdout = sink();
  const res = await runRelease(ARGS, {
    runBinary,
    getClient: () => statuses({ "demo/FB-1": "closed", "demo/FB-2": "pending_verification", "demo/FB-3": "closed" }),
    stdout,
    stderr: sink(),
  });
  assert.equal(res.status, 0);
  assert.deepEqual(calls, [[...ARGS, "--json"]]);
  assert.equal(
    stdout.text,
    [
      "Released: demo/FB-1, demo/FB-2, demo/FB-3",
      "  Closed (shipped): demo/FB-1, demo/FB-3",
      "  Moved to Verifying (waiting for QA): demo/FB-2",
      "  Record the QA result with `testmate feedback verify <ref>` or `testmate feedback reject <ref> --note \"…\"`.",
      "Skipped: demo/FB-9 (not_pending_release)",
      "",
    ].join("\n")
  );
});

test("text output on a project without QA verification only adds the closed line", async () => {
  const { runBinary } = binary({ released: ["demo/FB-1"], skipped: [], failures: [] });
  const stdout = sink();
  await runRelease(ARGS, { runBinary, getClient: () => statuses({ "demo/FB-1": "closed" }), stdout, stderr: sink() });
  assert.equal(
    stdout.text,
    "Released: demo/FB-1\n  Closed (shipped): demo/FB-1\nSkipped: none\n"
  );
});

test("nothing released never touches the API", async () => {
  const { runBinary } = binary(
    { released: [], skipped: [], failures: [{ reference: "demo/FB-5", error: "boom" }] },
    1
  );
  const stdout = sink();
  const res = await runRelease(ARGS, {
    runBinary,
    getClient: () => { throw new Error("should not be called"); },
    stdout,
    stderr: sink(),
  });
  assert.equal(res.status, 1, "keeps the binary's exit status");
  assert.equal(stdout.text, "Released: none\nSkipped: none\nFailed: demo/FB-5 (boom)\n");
});

test("--json adds closed and verifying arrays to the upstream JSON", async () => {
  const { calls, runBinary } = binary({ released: ["demo/FB-1", "demo/FB-2"], skipped: [], failures: [] });
  const stdout = sink();
  await runRelease([...ARGS, "--json"], {
    runBinary,
    getClient: () => statuses({ "demo/FB-1": "pending_verification", "demo/FB-2": "closed" }),
    stdout,
    stderr: sink(),
  });
  assert.deepEqual(calls, [[...ARGS, "--json"]], "does not add a second --json");
  assert.deepEqual(JSON.parse(stdout.text), {
    released: ["demo/FB-1", "demo/FB-2"],
    skipped: [],
    failures: [],
    closed: ["demo/FB-2"],
    verifying: ["demo/FB-1"],
  });
});

test("a failed status lookup is reported, not fatal", async () => {
  const { runBinary } = binary({ released: ["demo/FB-1", "demo/FB-2"], skipped: [], failures: [] });
  const stdout = sink();
  const stderr = sink();
  const res = await runRelease(ARGS, {
    runBinary,
    getClient: () => statuses({ "demo/FB-1": new Error("timeout"), "demo/FB-2": "pending_verification" }),
    stdout,
    stderr,
  });
  assert.equal(res.status, 0);
  assert.match(stdout.text, /Status unknown: demo\/FB-1 \(timeout\)/);
  assert.match(stdout.text, /Moved to Verifying \(waiting for QA\): demo\/FB-2/);
  assert.match(stderr.text, /could not read the new status of 1 item/);
});

test("non-JSON output (help, errors) passes through unchanged", async () => {
  const help = binary("Release feedback included in a deployed Git revision\n");
  const out1 = sink();
  await runRelease([...ARGS, "--help"], { runBinary: help.runBinary, getClient: () => null, stdout: out1 });
  assert.deepEqual(help.calls, [[...ARGS, "--help"]]);
  assert.equal(out1.text, "Release feedback included in a deployed Git revision\n");

  const failed = binary("", 1);
  const out2 = sink();
  const res = await runRelease(ARGS, { runBinary: failed.runBinary, getClient: () => null, stdout: out2 });
  assert.equal(res.status, 1);
  assert.equal(out2.text, "");
});
