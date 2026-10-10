#!/usr/bin/env node
"use strict";
// TestMate CLI: a thin wrapper around the @makethisbetter/cli Go binary that
// keeps its config in ~/.testmate/config.json and defaults to the TestMate
// server. Every upstream subcommand is passed through unchanged.
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const {
  TOKENS_URL,
  applyConfigEnv,
  defaultApiUrl,
  readConfig,
} = require("../lib/config");

function upstreamPackageDir() {
  return path.dirname(require.resolve("@makethisbetter/cli/package.json"));
}

// Same lookup as upstream's bin/makethisbetter: the per-platform optional
// dependency first, then the binary its postinstall downloaded.
function resolveBinary() {
  const {
    binaryExtension,
    packageBinarySpecifier,
  } = require("@makethisbetter/cli/scripts/platform");

  const specifier = packageBinarySpecifier(process.platform, process.arch);
  if (!specifier) {
    throw new Error(
      "Unsupported platform: " + process.platform + "/" + process.arch
    );
  }
  try {
    return require.resolve(specifier);
  } catch {}

  const fallback = path.join(
    upstreamPackageDir(),
    "downloaded",
    "makethisbetter" + binaryExtension(process.platform)
  );
  if (fs.existsSync(fallback)) return fallback;

  throw new Error(
    "Could not find the makethisbetter binary (" + specifier + ").\n" +
      "Try reinstalling: npm i -g github:beansmile/testmate-cli"
  );
}

function hasFlag(args, name) {
  return args.some((a) => a === name || a.startsWith(name + "="));
}

function isLogin(args) {
  // First non-flag argument is the subcommand.
  const cmd = args.find((a) => !a.startsWith("-"));
  return cmd === "login";
}

function isHelp(args) {
  if (args.length === 0) return true;
  if (args.length === 1 && ["help", "--help", "-h"].includes(args[0])) return true;
  return false;
}

function main() {
  const args = process.argv.slice(2);
  const env = process.env;
  const configPath = applyConfigEnv(env);

  if (isLogin(args)) {
    if (!hasFlag(args, "--token") && !hasFlag(args, "--email") &&
        !hasFlag(args, "--otp") && !hasFlag(args, "--help") && !hasFlag(args, "-h")) {
      process.stderr.write(
        [
          "请先在 TestMate 创建 API Token：" + TOKENS_URL,
          "然后运行：testmate login --token <token>",
          "",
          "Create an API token at " + TOKENS_URL,
          "then run: testmate login --token <token>",
          "",
        ].join("\n")
      );
      process.exit(1);
    }
    if (!hasFlag(args, "--api-url")) args.push("--api-url", defaultApiUrl(env));
  } else if (!env.MTB_API_URL) {
    // The Go binary falls back to makethisbetter.dev when the config has no
    // api_url (e.g. CI using only an env token). Point it at TestMate instead.
    const cfg = readConfig(configPath);
    if (!cfg || !cfg.api_url) env.MTB_API_URL = defaultApiUrl(env);
  }
  // Convenience alias for CI: TESTMATE_API_TOKEN -> upstream MTB_API_TOKEN.
  if (env.TESTMATE_API_TOKEN && !env.MTB_API_TOKEN) {
    env.MTB_API_TOKEN = env.TESTMATE_API_TOKEN;
  }

  if (isHelp(args)) process.stdout.write("TestMate CLI (wraps @makethisbetter/cli)\n");

  let binary;
  try {
    binary = resolveBinary();
  } catch (e) {
    process.stderr.write(e.message + "\n");
    process.exit(1);
  }

  const result = spawnSync(binary, args, { stdio: "inherit", env });
  if (result.error) {
    process.stderr.write(result.error.message + "\n");
    process.exit(1);
  }
  if (result.signal) {
    process.kill(process.pid, result.signal);
    return;
  }
  process.exit(result.status === null ? 1 : result.status);
}

main();
