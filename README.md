# TestMate CLI

[English](#english) · 中文

`testmate` 是 [TestMate](https://testmate.beansmile.ai) 的命令行工具：在终端里查看、认领、完成并发布用户反馈。它是对上游 [`@makethisbetter/cli`](https://github.com/makethisbetter/cli) 的轻量封装（固定版本 1.10.0），所有上游子命令均可原样使用，只是：

- 配置保存在 `~/.testmate/config.json`（不会覆盖你在 makethisbetter.dev 的登录）；
- `testmate login` 默认连接 `https://testmate.beansmile.ai/api/v1`。

## 安装

需要 Node.js 18+。通过 GitHub 安装（不发布到 npm）：

```bash
npm i -g github:beansmile/testmate-cli
testmate --help
```

不想全局安装时可以直接用 `npx`：

```bash
npx -y github:beansmile/testmate-cli --help
```

## 登录

1. 打开 <https://testmate.beansmile.ai/settings/tokens> 创建一个 API Token；
2. 运行：

```bash
testmate login --token <token>
testmate info        # 查看当前连接状态
```

不带参数运行 `testmate login` 会打印上面的提示。如需连接其它 TestMate 服务器，传 `--api-url`，或设置环境变量 `TESTMATE_API_URL`（作为默认 API 地址）。

## 日常流程

```bash
# 1. 看看有哪些待处理的反馈
testmate feedback list --project demo
testmate feedback list --project demo --status received --sort priority

# 2. 认领一条（状态变为 in_progress）
testmate feedback pick demo/FB-12
testmate feedback show demo/FB-12

# 3. 改完代码、提交后，标记为待发布
testmate feedback ready demo/FB-12 --summary "修复了登录页在 Safari 下的布局错位"

# 4. 部署后，把该提交之前所有 ready 的反馈标记为已发布
testmate feedback release --project demo --through "$(git rev-parse HEAD)"
```

其它子命令：`respond`、`decline`、`duplicate`、`reopen`、`archive`、`restore`、`project list/show/create/update` 等，用法见 `testmate <command> --help`。加 `--json` 可输出 JSON。

## CI 中自动发布

`release` 需要完整的 Git 历史来判断哪些反馈包含在本次部署中，所以 CI 里一定要关闭浅克隆。把 Token 存为 CI 密钥 `TESTMATE_API_TOKEN`（包装器会把它传给上游的 `MTB_API_TOKEN`，并在没有配置文件时默认使用 TestMate 服务器）。

**GitLab CI**

```yaml
release-feedback:
  stage: deploy
  image: node:20
  variables:
    GIT_DEPTH: 0
  script:
    - npx -y github:beansmile/testmate-cli feedback release --project demo --through $CI_COMMIT_SHA
  rules:
    - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH
```

**GitHub Actions**

```yaml
- uses: actions/checkout@v4
  with:
    fetch-depth: 0
- uses: actions/setup-node@v4
  with:
    node-version: 20
- run: npx -y github:beansmile/testmate-cli feedback release --project demo --through ${{ github.sha }}
  env:
    TESTMATE_API_TOKEN: ${{ secrets.TESTMATE_API_TOKEN }}
```

## 配置与环境变量

| 项 | 说明 |
| --- | --- |
| `~/.testmate/config.json` | 默认配置文件（`api_token`、`api_url`、`account_id`、`user_email`），权限 0600 |
| `MAKETHISBETTER_CONFIG` | 若已设置，则使用该路径而不是 `~/.testmate/config.json` |
| `TESTMATE_API_URL` | 默认 API 地址（默认 `https://testmate.beansmile.ai/api/v1`） |
| `TESTMATE_API_TOKEN` | CI 用 Token，等价于上游的 `MTB_API_TOKEN` |
| `MTB_API_TOKEN` / `MTB_API_URL` | 上游原生环境变量，优先级高于配置文件 |

首次运行时，如果 `~/.testmate/config.json` 不存在而 `~/.makethisbetter/config.json` 存在，会自动复制一份过来（只做一次）。

MCP 服务器（给 Claude Code / Cursor / Codex 用）见 [beansmile/testmate-mcp](https://github.com/beansmile/testmate-mcp)，它读取同一个配置文件。

---

## English

`testmate` is the command-line client for [TestMate](https://testmate.beansmile.ai). It wraps [`@makethisbetter/cli`](https://github.com/makethisbetter/cli) (pinned to 1.10.0); every upstream subcommand works unchanged. Differences: config lives in `~/.testmate/config.json`, and `testmate login` defaults to `https://testmate.beansmile.ai/api/v1` (override with `--api-url` or `TESTMATE_API_URL`).

```bash
npm i -g github:beansmile/testmate-cli      # or: npx -y github:beansmile/testmate-cli <command>
testmate login --token <token>              # create one at https://testmate.beansmile.ai/settings/tokens
testmate feedback list --project demo
testmate feedback pick demo/FB-12
testmate feedback ready demo/FB-12 --summary "What changed"
testmate feedback release --project demo --through "$(git rev-parse HEAD)"
```

In CI, disable shallow clones (GitLab `GIT_DEPTH: 0`, GitHub Actions `fetch-depth: 0`) and pass the token as `TESTMATE_API_TOKEN`. See the Chinese section above for full CI examples and the environment-variable table.

## License

MIT
