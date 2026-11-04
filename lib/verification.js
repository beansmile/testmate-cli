"use strict";
// `testmate feedback verify` / `testmate feedback reject`: record the QA result
// for Feedback waiting in pending_verification. TestMate-only, so implemented
// here rather than in the upstream binary.
const { ApiError, UsageError, parseFeedbackReference } = require("./api");

const NOTE_MAX = 2000;

const HELP = {
  verify: [
    "Pass QA verification and close Feedback as shipped",
    "",
    "Usage:",
    "  testmate feedback verify <handle/FB-n> [flags]",
    "",
    "Records a passed verification for Feedback in pending_verification (\"Verifying\")",
    "and closes it as closed(shipped). Only projects with QA verification turned on",
    "send released Feedback to Verifying.",
    "",
    "Flags:",
    "      --evidence string   http(s) URL with proof, e.g. a test run or screenshot",
    "  -h, --help              help for verify",
    "      --json              print JSON output",
    "      --note string       what was checked (optional, max " + NOTE_MAX + " characters)",
    "",
  ].join("\n"),
  reject: [
    "Fail QA verification and send Feedback back to in_progress",
    "",
    "Usage:",
    "  testmate feedback reject <handle/FB-n> --note \"<what failed>\" [flags]",
    "",
    "Records a failed verification for Feedback in pending_verification (\"Verifying\").",
    "It returns to in_progress with the same assignee. Fix it, commit with the same",
    "`Feedback: <handle/FB-n>` trailer, and run `testmate feedback ready` again.",
    "",
    "Flags:",
    "      --evidence string   http(s) URL with proof, e.g. a failing test run or screenshot",
    "  -h, --help              help for reject",
    "      --json              print JSON output",
    "      --note string       what failed (required, max " + NOTE_MAX + " characters)",
    "",
  ].join("\n"),
};

const SHORT = {
  verify: "Pass QA verification and close feedback as shipped",
  reject: "Fail QA verification and send feedback back to in_progress",
};

const VALUE_FLAGS = new Set(["--note", "--evidence"]);
const BOOL_FLAGS = new Set(["--json", "--help", "-h"]);

// Small cobra-compatible parser: `--flag value`, `--flag=value`, and `--` to
// end flag parsing. Unknown flags are errors, like cobra.
function parseArgs(args) {
  const out = { positionals: [], flags: {} };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--") {
      out.positionals.push(...args.slice(i + 1));
      break;
    }
    if (!arg.startsWith("-") || arg === "-") {
      out.positionals.push(arg);
      continue;
    }
    const eq = arg.indexOf("=");
    const name = eq === -1 ? arg : arg.slice(0, eq);
    if (BOOL_FLAGS.has(name)) {
      const value = eq === -1 ? "true" : arg.slice(eq + 1);
      if (value !== "true" && value !== "false") throw new UsageError("invalid argument " + JSON.stringify(value) + " for " + name);
      out.flags[name === "-h" ? "--help" : name] = value === "true";
      continue;
    }
    if (VALUE_FLAGS.has(name)) {
      let value;
      if (eq !== -1) value = arg.slice(eq + 1);
      else if (i + 1 < args.length) value = args[++i];
      else throw new UsageError("flag needs an argument: " + name);
      out.flags[name] = value;
      continue;
    }
    throw new UsageError("unknown flag: " + name);
  }
  return out;
}

function validEvidenceUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

// Turns argv (after `feedback <verify|reject>`) into a request, or throws UsageError.
function buildVerification(command, args) {
  const { positionals, flags } = parseArgs(args);
  if (flags["--help"]) return { help: true };
  if (positionals.length !== 1) {
    throw new UsageError("accepts 1 arg(s), received " + positionals.length + "\nUsage: testmate feedback " + command + " <handle/FB-n>");
  }
  const reference = positionals[0];
  parseFeedbackReference(reference);

  const note = typeof flags["--note"] === "string" ? flags["--note"].trim() : "";
  const evidence = typeof flags["--evidence"] === "string" ? flags["--evidence"].trim() : "";
  if (command === "reject" && !note) {
    throw new UsageError("--note is required: say what failed so the developer can fix it");
  }
  if (note.length > NOTE_MAX) throw new UsageError("--note must be at most " + NOTE_MAX + " characters");
  if (evidence && !validEvidenceUrl(evidence)) throw new UsageError("--evidence must be an http(s) URL");

  const verification = { outcome: command === "verify" ? "passed" : "failed" };
  if (note) verification.note = note;
  if (evidence) verification.evidence_url = evidence;
  return { reference, verification, json: Boolean(flags["--json"]) };
}

function bullet(text, color) {
  return (color ? "\u001b[32m*\u001b[0m" : "*") + " " + text;
}

function describeResult(command, feedback, color) {
  const ref = feedback.reference || feedback.id;
  const lines = [];
  if (command === "verify") {
    const state = feedback.status === "closed"
      ? "closed" + (feedback.close_reason ? " (" + feedback.close_reason + ")" : "")
      : feedback.status;
    lines.push(bullet("Feedback " + ref + " passed verification and is " + state + ".", color));
  } else {
    const assignee = feedback.assignee && feedback.assignee.name ? " (assignee: " + feedback.assignee.name + ")" : "";
    const state = feedback.status === "in_progress" ? "back in progress" : "now " + feedback.status;
    lines.push(bullet("Feedback " + ref + " failed verification and is " + state + assignee + ".", color));
    lines.push("  Fix it, commit with `Feedback: " + ref + "`, then run `testmate feedback ready " + ref + " --summary \"…\"` again.");
  }
  if (feedback.title) lines.push("  Title: " + feedback.title);
  return lines.join("\n") + "\n";
}

function friendlyApiError(command, reference, error) {
  if (error instanceof ApiError && error.status === 409) {
    return error.message + " Check it with `testmate feedback show " + reference + "`.";
  }
  return error.message;
}

// Returns the process exit code.
async function runVerification(command, args, { client, stdout = process.stdout, stderr = process.stderr, color = false } = {}) {
  let request;
  try {
    request = buildVerification(command, args);
  } catch (error) {
    stderr.write("Error: " + error.message + "\n");
    return 1;
  }
  if (request.help) {
    stdout.write(HELP[command]);
    return 0;
  }
  try {
    const c = typeof client === "function" ? client() : client;
    const feedback = await c.verifyFeedback(request.reference, request.verification);
    if (request.json) stdout.write(JSON.stringify(feedback, null, 2) + "\n");
    else stdout.write(describeResult(command, feedback, color));
    return 0;
  } catch (error) {
    const verb = command === "verify" ? "verifying" : "rejecting";
    stderr.write("Error: " + (error instanceof UsageError ? error.message : verb + " feedback: " + friendlyApiError(command, request.reference, error)) + "\n");
    return 1;
  }
}

module.exports = {
  HELP,
  NOTE_MAX,
  SHORT,
  buildVerification,
  describeResult,
  parseArgs,
  runVerification,
};
