"use strict";
// Shared config resolution for the TestMate wrappers.
//
// The upstream binary (and the upstream MCP server) read their config from
// $MAKETHISBETTER_CONFIG, falling back to ~/.makethisbetter/config.json.
// TestMate keeps its own file at ~/.testmate/config.json so it never clobbers
// a real makethisbetter.dev login on the same machine.
const fs = require("fs");
const os = require("os");
const path = require("path");

const DEFAULT_API_URL = "https://testmate.beansmile.ai/api/v1";
const TOKENS_URL = "https://testmate.beansmile.ai/settings/tokens";

function testmateConfigPath() {
  return path.join(os.homedir(), ".testmate", "config.json");
}

function legacyConfigPath() {
  return path.join(os.homedir(), ".makethisbetter", "config.json");
}

// One-time migration: if ~/.testmate/config.json is missing but an upstream
// config exists, copy it across (owner-only permissions, like upstream).
function migrateLegacyConfig(target) {
  const legacy = legacyConfigPath();
  if (fs.existsSync(target) || !fs.existsSync(legacy)) return false;
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
    fs.copyFileSync(legacy, target, fs.constants.COPYFILE_EXCL);
    fs.chmodSync(target, 0o600);
    return true;
  } catch {
    return false;
  }
}

// Points the upstream tools at the TestMate config unless the caller already
// chose a path via MAKETHISBETTER_CONFIG. Returns the effective path.
function applyConfigEnv(env = process.env) {
  if (env.MAKETHISBETTER_CONFIG) return env.MAKETHISBETTER_CONFIG;
  const target = testmateConfigPath();
  migrateLegacyConfig(target);
  env.MAKETHISBETTER_CONFIG = target;
  return target;
}

function readConfig(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function defaultApiUrl(env = process.env) {
  return (env.TESTMATE_API_URL || DEFAULT_API_URL).replace(/\/+$/, "");
}

module.exports = {
  DEFAULT_API_URL,
  TOKENS_URL,
  applyConfigEnv,
  defaultApiUrl,
  legacyConfigPath,
  migrateLegacyConfig,
  readConfig,
  testmateConfigPath,
};
