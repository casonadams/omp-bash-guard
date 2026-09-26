# omp-bash-guard

Security gatekeeper extension and plugin for
[oh-my-pi](https://github.com/can1357/oh-my-pi).

Intercepts bash commands before execution and evaluates their risk against your
software engineering, cloud infrastructure, and database rules using your
configured **guard** or **judge** model.

## Features

- **Decoupled Model Configuration**: Uses your configured `guard` model role in
  `config.yml` (falls back to `judge`). Works with any provider supported by
  oh-my-pi (Ollama, Anthropic, OpenAI, Gemini, Bedrock, etc.)—no hardcoded
  Ollama dependencies.
- **Fail-Safe Enforcement**: If no guard/judge model is configured or
  credentials are missing, commands cannot run silently; you are prompted with
  an alert.
- **Interactive TUI Ask Dialog**: Flagged commands present the native oh-my-pi
  `ask` selection overlay (`Proceed`, `Cancel`, or `Other` for custom feedback).
- **Zero-Latency Critical Regex**: Instant interception for catastrophic
  patterns (`rm -rf /`, `git reset --hard`, `mkfs`, raw device writes).
- **Developer-Friendly Boundaries**: Safe local operations (builds, tests,
  linters, repo file edits, dry-runs) are evaluated as safe without interrupting
  flow.

## Configuration

In `~/.omp/agent/config.yml`, add a `guard` entry under `modelRoles:`

```yaml
modelRoles:
  guard: ollama/qwen2.5-coder:7b # Or any other model e.g. google-antigravity/gemini-3.8-flash:medium
```

If `guard` is not set, it will automatically fall back to your `judge` role. If
neither is set, execution is blocked until you configure one.

## Installation

Install directly via `omp plugin`:

```bash
omp plugin install github:casonadams/omp-bash-guard
```

Or for local development:

```bash
omp plugin link /path/to/omp-bash-guard
```
