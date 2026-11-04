"use strict";
// Wraps upstream `feedback release` so its output says where each released
// item went. On projects with QA verification turned on, the server moves
// released Feedback to pending_verification ("Verifying") instead of closing
// it. The upstream binary only reports "Released", so we ask it for JSON,
// look up each released reference, and print the split.

const STATUS_GROUPS = [
  { key: "closed", match: (f) => f.status === "closed" },
  { key: "verifying", match: (f) => f.status === "pending_verification" },
];

function hasJsonFlag(args) {
  return args.some((a) => a === "--json" || a === "--json=true");
}

function wantsHelp(args) {
  return args.some((a) => a === "--help" || a === "-h" || a === "--help=true");
}

function list(values) {
  return values.length === 0 ? "none" : values.join(", ");
}

// Look up the status of every released reference. Lookup errors are reported,
// not fatal: the release itself already happened.
async function classifyReleased(released, client) {
  const result = { closed: [], verifying: [], other: [], unknown: [] };
  for (const reference of released) {
    try {
      const feedback = await client.getFeedback(reference);
      const group = STATUS_GROUPS.find((g) => g.match(feedback));
      if (group) result[group.key].push(reference);
      else result.other.push({ reference, status: feedback.status });
    } catch (error) {
      result.unknown.push({ reference, error: error && error.message ? error.message : String(error) });
    }
  }
  return result;
}

function formatText(result, split) {
  const lines = ["Released: " + list(result.released)];
  if (result.released.length > 0) {
    // Only non-empty groups, so projects without QA verification just see "Closed".
    if (split.closed.length > 0) lines.push("  Closed (shipped): " + list(split.closed));
    if (split.verifying.length > 0) lines.push("  Moved to Verifying (waiting for QA): " + list(split.verifying));
    for (const item of split.other) lines.push("  Now " + item.status + ": " + item.reference);
    for (const item of split.unknown) lines.push("  Status unknown: " + item.reference + " (" + item.error + ")");
    if (split.verifying.length > 0) {
      lines.push("  Record the QA result with `testmate feedback verify <ref>` or `testmate feedback reject <ref> --note \"…\"`.");
    }
  }
  const skipped = (result.skipped || []).map((s) => s.reference + " (" + s.reason + ")");
  lines.push("Skipped: " + list(skipped));
  for (const failure of result.failures || []) {
    lines.push("Failed: " + failure.reference + " (" + failure.error + ")");
  }
  return lines.join("\n") + "\n";
}

// runBinary(args) -> { status, signal, stdout } with stderr already inherited.
// getClient() -> API client, created lazily so a failed release never needs it.
async function runRelease(args, { runBinary, getClient, stdout = process.stdout, stderr = process.stderr }) {
  if (wantsHelp(args)) {
    const res = runBinary(args);
    stdout.write(res.stdout || "");
    return res;
  }
  const userJson = hasJsonFlag(args);
  const res = runBinary(userJson ? args : [...args, "--json"]);
  const raw = res.stdout || "";

  let result;
  try {
    result = JSON.parse(raw);
  } catch {
    result = null;
  }
  if (!result || !Array.isArray(result.released)) {
    // Not the release JSON (e.g. a git-history error printed nothing): pass it through.
    stdout.write(raw);
    return res;
  }

  let split = { closed: [], verifying: [], other: [], unknown: [] };
  if (result.released.length > 0) {
    let client = null;
    try {
      client = getClient();
    } catch (error) {
      split.unknown = result.released.map((reference) => ({ reference, error: error.message }));
    }
    if (client) split = await classifyReleased(result.released, client);
  }

  if (userJson) {
    const augmented = { ...result, closed: split.closed, verifying: split.verifying };
    if (split.other.length > 0) augmented.other = split.other;
    if (split.unknown.length > 0) augmented.status_unknown = split.unknown;
    stdout.write(JSON.stringify(augmented, null, 2) + "\n");
  } else {
    stdout.write(formatText(result, split));
  }
  if (split.unknown.length > 0 && !userJson) {
    stderr.write("Warning: released, but could not read the new status of " + split.unknown.length + " item(s).\n");
  }
  return res;
}

module.exports = { classifyReleased, formatText, hasJsonFlag, runRelease };
