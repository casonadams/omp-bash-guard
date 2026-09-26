# omp-bash-guard

Security gatekeeper extension and plugin for
[oh-my-pi](https://github.com/can1357/oh-my-pi).

Intercepts bash commands before execution and evaluates their risk against your
software engineering, cloud infrastructure, and database rules using your
configured **guard** or **judge** model.

## Features

- **Decoupled Model Configuration**: Uses your configured `guard` model role in
  `config.yml` (falls back to `judge`). Works with any provider supported by
  oh-my-pi (Ollama, Anthropic, OpenAI, Gemini, Bedrock, etc.)

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

Configure your `~/.omp/agent/config.yml` with `approvalMode: yolo` alongside the
`guard` model role:

```yaml
tools:
  approvalMode: yolo

modelRoles:
  guard: ollama/qwen2.5-coder:7b # Recommended local model (falls back to judge)
```

### Why `approvalMode: yolo`?

By default, oh-my-pi prompts for manual human approval on tool executions. When
paired with `omp-bash-guard`, you can safely enable `approvalMode: yolo`:

- **Zero Interruption for Safe Work**: Benign developer actions (builds, tests,
  linters, git inspections, file edits) execute instantly without manual confirm
  prompts.
- **Targeted Interception**: The guard intercepts and pauses execution _only_
  when a command is destructive, mutates cloud or database infrastructure,
  exfiltrates secrets, or poses security risk.

### Recommended Local Model: `qwen2.5-coder:7b`

For local, offline command inspection without cloud API latency or cost,
`ollama/qwen2.5-coder:7b` is strongly recommended for the `guard` role:

- **Domain Comprehension**: Pretrained extensively on code, shell scripts, and
  DevOps tools (git, kubectl, terraform, docker, cloud CLIs, database clients),
  enabling accurate discrimination between benign local dev commands and
  destructive operations.
- **Low Latency & Small Footprint**: At ~4.7 GB quantized (Q4_K_M), it fits
  easily into standard Apple Silicon unified memory or consumer GPUs, providing
  fast classification without perceptible CLI lag.
- **Reliable Structured Output**: Consistently produces deterministic JSON
  matching the required schema at `temperature: 0.0` without conversational
  hallucinations.
- **Air-Gapped Privacy**: Shell commands, local paths, arguments, and sensitive
  parameters remain on-device and are never transmitted to third-party endpoints.
- **Offline Resilience**: Guards remain functional during network outages,
  disconnected flights, or strict air-gapped enterprise environments.

## Installation

Install directly via `omp plugin`:

```bash
omp plugin install github:casonadams/omp-bash-guard
```

Or for local development:

```bash
omp plugin link /path/to/omp-bash-guard
```
