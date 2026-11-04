"use strict";
// Minimal TestMate API client for the commands the wrapper implements itself
// (the upstream Go binary has no QA verification step). It reads the same
// config file and environment overrides as the binary, so a single
// `testmate login` serves both.
const { defaultApiUrl, readConfig } = require("./config");

const REQUEST_TIMEOUT_MS = 30000;

// Same patterns as upstream internal/api/client.go.
const PROJECT_HANDLE = "[a-z0-9](?:[a-z0-9-]{2,61}[a-z0-9])";
const FEEDBACK_REFERENCE_PATTERN = new RegExp("^(" + PROJECT_HANDLE + ")/FB-([1-9][0-9]*)$");

class ApiError extends Error {
  constructor(status, message, body) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
    this.code = body && typeof body === "object" && typeof body.code === "string" ? body.code : undefined;
  }
}

class UsageError extends Error {
  constructor(message) {
    super(message);
    this.name = "UsageError";
  }
}

function parseFeedbackReference(reference) {
  const match = FEEDBACK_REFERENCE_PATTERN.exec(reference || "");
  if (!match || match[1].slice(2, 4) === "--") {
    throw new UsageError(
      "feedback reference must look like <handle>/FB-<number>, e.g. acme/FB-42 (got " +
        JSON.stringify(reference || "") + ")"
    );
  }
  return { handle: match[1], number: match[2] };
}

// Resolves the effective connection settings the way the Go binary does:
// config file first, then MTB_API_TOKEN / MTB_API_URL overrides. The wrapper
// already mapped TESTMATE_API_TOKEN onto MTB_API_TOKEN before calling this.
function loadConnection(configPath, env = process.env) {
  const cfg = readConfig(configPath) || {};
  const token = (env.MTB_API_TOKEN || cfg.api_token || "").trim();
  const apiUrl = (env.MTB_API_URL || cfg.api_url || defaultApiUrl(env)).replace(/\/+$/, "");
  const accountId = typeof cfg.account_id === "string" ? cfg.account_id.trim() : "";
  if (!token) {
    throw new UsageError("not logged in, run `testmate login --token <token>` first");
  }
  return { token, apiUrl, accountId: accountId || undefined };
}

function apiUrlForVersion(apiUrl, version) {
  if (!/\/v1$/.test(apiUrl)) {
    throw new UsageError(
      "api_url must end in /v1 for feedback workflow commands; run `testmate login --token <token> --api-url <server>/api/v1`"
    );
  }
  return apiUrl.slice(0, -2) + version;
}

function statusHint(status) {
  switch (status) {
    case 401:
      return "authentication failed, run `testmate login --token <token>` to re-authenticate";
    case 403:
      return "not authorized for this project or account, check `testmate project list` and the account_id in your config";
    case 404:
      return "not found, check the project handle and feedback number with `testmate feedback list --project <handle>`";
    case 422:
      return "the API rejected the request as invalid, check the flag values and try again";
    default:
      return "API request failed with status " + status;
  }
}

function errorMessage(status, body) {
  // A 401 is always about the stored token, so the login hint beats the server wording.
  if (status === 401) return statusHint(401);
  if (body && typeof body === "object" && typeof body.error === "string" && body.error.trim()) {
    return body.error.trim();
  }
  return statusHint(status);
}

function createClient({ apiUrl, token, accountId, fetchImpl = globalThis.fetch }) {
  async function request(baseUrl, path, init = {}) {
    const url = new URL(baseUrl + path);
    if (accountId) url.searchParams.set("account_id", accountId);
    const response = await fetchImpl(url.toString(), {
      ...init,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: {
        Authorization: "Bearer " + token,
        Accept: "application/json",
        "Content-Type": "application/json",
        ...(init.headers || {}),
      },
    });
    const text = response.status === 204 ? "" : await response.text();
    let body = null;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
    }
    if (!response.ok) throw new ApiError(response.status, errorMessage(response.status, body), body);
    return body;
  }

  function feedbackPath(reference, suffix = "") {
    const { handle, number } = parseFeedbackReference(reference);
    return "/projects/" + encodeURIComponent(handle) + "/feedbacks/" + number + suffix;
  }

  return {
    getFeedback(reference) {
      return request(apiUrl, feedbackPath(reference));
    },
    // POST /api/v2/projects/:handle/feedbacks/:n/verification (TestMate-only).
    verifyFeedback(reference, verification) {
      return request(apiUrlForVersion(apiUrl, "v2"), feedbackPath(reference, "/verification"), {
        method: "POST",
        body: JSON.stringify({ feedback_verification: verification }),
      });
    },
  };
}

module.exports = {
  ApiError,
  FEEDBACK_REFERENCE_PATTERN,
  UsageError,
  apiUrlForVersion,
  createClient,
  loadConnection,
  parseFeedbackReference,
};
