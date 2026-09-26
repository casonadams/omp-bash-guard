import { completeSimple, type Api, type Model } from "@oh-my-pi/pi-ai";

interface ToolCallEvent {
  toolName: string;
  input?: Record<string, unknown>;
}

interface BlockResult {
  block: boolean;
  reason: string;
}

interface ExtensionAskDialogOption {
  label: string;
  description?: string;
  preview?: string;
}

interface ExtensionAskDialogQuestion {
  id: string;
  question: string;
  header?: string;
  options: ExtensionAskDialogOption[];
  multi?: boolean;
  recommended?: number;
}

interface ExtensionAskDialogResultItem {
  id: string;
  selectedOptions: string[];
  customInput?: string;
}

interface ExtensionAskDialogSubmitResult {
  kind: "submit";
  results: ExtensionAskDialogResultItem[];
}

interface ExtensionAskDialogChatResult {
  kind: "chat";
}

type ExtensionAskDialogResult = ExtensionAskDialogSubmitResult | ExtensionAskDialogChatResult;

interface ExtensionUIContext {
  confirm(title: string, message: string, options?: { signal?: AbortSignal }): Promise<boolean>;
  askDialog?(
    questions: ExtensionAskDialogQuestion[],
    dialogOptions?: { signal?: AbortSignal },
  ): Promise<ExtensionAskDialogResult | undefined>;
  notify(message: string, level?: "info" | "warning" | "error"): void;
}

interface ExtensionModelQuery {
  list(): Model<Api>[];
  current(): Model<Api> | undefined;
  resolve(spec: string): Model<Api> | undefined;
  family(model: Model<Api>): string;
}

interface ModelRegistry {
  getApiKey(
    model: Model<Api>,
    sessionId?: string,
    options?: { signal?: AbortSignal },
  ): Promise<string | undefined>;
}

interface ExtensionContext {
  hasUI?: boolean;
  ui?: ExtensionUIContext;
  cwd?: string;
  models?: ExtensionModelQuery;
  modelRegistry?: ModelRegistry;
}

interface PiExtensionAPI {
  on(
    event: "tool_call",
    handler: (event: ToolCallEvent, ctx?: ExtensionContext) => Promise<BlockResult | void>,
  ): void;
}

export const CRITICAL_DANGER_REGEX =
  /(\brm\s+-[a-zA-Z]*r[a-zA-Z]*f?\s+([/~]|\.\.|\*)|mkfs|dd\s+if=|>+\s*\/dev\/sd|:\(\)\s*\{\s*:\|:&\s*\};:|chmod\s+-[a-zA-Z]*R\s+777|\bgit\s+clean\s+-[a-zA-Z]*f[a-zA-Z]*d|\bgit\s+reset\s+--hard\b|\bpsql\b.*(DROP\s+(DATABASE|SCHEMA|TABLE)|TRUNCATE\b|DELETE\s+FROM\b|ALTER\s+(TABLE|ROLE)\b)|\bkubectl\s+(delete\s+(all|namespace|ns\b)|drain\b|cordon\b)|\bgcloud\s+.*delete\b|\bgcloud\s+iam\s+.*delete)/i;

export default function (pi: PiExtensionAPI) {
  pi.on(
    "tool_call",
    async (event: ToolCallEvent, ctx?: ExtensionContext): Promise<BlockResult | void> => {
      if (event.toolName !== "bash") return;

      const command =
        typeof event.input?.command === "string" ? event.input.command.trim() : undefined;
      if (!command) return;

      const promptUserOrBlock = async (reason: string): Promise<BlockResult | void> => {
        if (ctx?.hasUI) {
          if (typeof ctx.ui?.askDialog === "function") {
            const res = await ctx.ui.askDialog([
              {
                id: "bash_guard_approval",
                header: "Bash Guard",
                question: `Command flagged by Bash Guard:\n\`\`\`bash\n${command}\n\`\`\`\n**Security Audit:** ${reason}\n\nDo you want to proceed with execution?`,
                recommended: 1, // Default cursor on Cancel for safety
                options: [
                  {
                    label: "Proceed",
                    description: "Execute the command as requested",
                    preview: command,
                  },
                  {
                    label: "Cancel",
                    description: "Block execution of this command",
                  },
                ],
              },
            ]);

            if (res?.kind === "submit") {
              const selected = res.results[0]?.selectedOptions[0];
              if (selected === "Proceed") {
                return;
              }
              if (res.results[0]?.customInput) {
                return {
                  block: true,
                  reason: `User blocked with feedback: ${res.results[0].customInput}`,
                };
              }
            }

            return {
              block: true,
              reason: `User denied execution: ${reason}`,
            };
          }

          if (typeof ctx.ui?.confirm === "function") {
            const approved = await ctx.ui.confirm(
              "⚠️ Sensitive / Unsafe Command Approval",
              `Command:\n$ ${command}\n\nSecurity Audit:\n${reason}\n\nDo you want to allow this command to execute?`,
            );
            if (approved) {
              return;
            }
            return {
              block: true,
              reason: `User denied execution: ${reason}`,
            };
          }
        }

        return {
          block: true,
          reason: `[Bash Guard] Blocked unsafe command (headless mode): ${reason}`,
        };
      };

      // 1. Fast-path instant catch for critically destructive operations
      if (CRITICAL_DANGER_REGEX.test(command)) {
        return await promptUserOrBlock(
          "Critical destructive or irreversible infrastructure action detected.",
        );
      }

      // 2. Resolve guard model from configured modelRoles: check '@guard' first, fallback to '@judge'
      const modelsQuery = ctx?.models;
      const modelRegistry = ctx?.modelRegistry;

      const guardModel = modelsQuery?.resolve("@guard") ?? modelsQuery?.resolve("@judge");

      if (!guardModel) {
        return await promptUserOrBlock(
          "No guard or judge model configured! Set `modelRoles.guard: <provider/model>` (or `modelRoles.judge`) in ~/.omp/agent/config.yml before executing shell commands.",
        );
      }

      // 3. Ensure API key or credentials exist for the resolved guard model
      const apiKey = await modelRegistry?.getApiKey(guardModel).catch(() => undefined);
      if (!apiKey && guardModel.api !== "local-inference" && guardModel.provider !== "ollama") {
        return await promptUserOrBlock(
          `Guard model "${guardModel.provider}/${guardModel.id}" requires an API key, but none was found.`,
        );
      }

      const systemPrompt = `You are a security gatekeeper for shell commands in a software engineering, cloud, database, and VM development workspace.
Classify the command as SAFE (automatic execution) or UNSAFE (requires human approval).

GUIDING PRINCIPLE:
- SAFE: Local, bounded to the current project/repo, read-only, or easily reversible.
- UNSAFE: External/remote impact, destructive, exfiltrating secrets, or altering system/cloud state.

1. SAFE (Mark safe: true):
- Read-only inspection: git status/diff/log, cat, grep, ls, find, ps, lsof, jq, curl GET/inspect.
- Local build/test/lint: bun, npm, cargo, go, make, pytest, clippy, typecheckers.
- Local repo file operations: touch, mkdir, editing code, creating branches.
- Cleaning local build artifacts: cargo clean, rm -rf dist/build/target/.cache, deleting ephemeral repo files.
- Dry runs & read-only cloud/DB queries: terraform plan, kubectl diff/get/describe, SELECT/EXPLAIN queries.

2. UNSAFE (Mark safe: false):
- Cloud & Infrastructure changes: terraform/tofu apply/destroy, kubectl apply/delete/patch/exec/drain, gcloud/aws/az create/delete/modify.
- Database & Datastore mutations: INSERT, UPDATE, DELETE, DROP, TRUNCATE, ALTER, migrations, redis FLUSHALL/DEL.
- Git destructive / remote changes: git push (especially --force), git reset --hard, git clean -fd, deleting remote branches.
- Package publishing / releases: npm publish, cargo publish, docker push, git tag push.
- Secret exposure & network pipes: cat/grep on ~/.ssh, ~/.aws, .env, piping web scripts to shell (curl|bash), sending credentials off-machine.
- System & VM modification: sudo, chown, chmod 777, altering /etc or system services, destructive rm outside the project directory.

Respond with valid JSON only in this exact schema:
{"safe": boolean, "reason": "concise explanation"}`;

      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 4000);

        const response = await completeSimple(
          guardModel,
          {
            systemPrompt: [systemPrompt],
            messages: [
              {
                role: "user",
                content: [
                  {
                    type: "text",
                    text: `Command to evaluate:\n\`\`\`bash\n${command}\n\`\`\``,
                  },
                ],
                timestamp: Date.now(),
              },
            ],
          },
          {
            apiKey,
            signal: controller.signal,
            temperature: 0.0,
            maxTokens: 120,
          },
        );

        clearTimeout(timeoutId);

        const textBlock = response.content.find(
          (block): block is { type: "text"; text: string } =>
            block.type === "text" && "text" in block && typeof block.text === "string",
        );
        if (!textBlock) {
          throw new Error("No text response received from guard model");
        }

        // Parse JSON from text output (extract between braces if surrounded by markdown)
        const jsonMatch = textBlock.text.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
          throw new Error("Invalid non-JSON response from guard model");
        }

        const verdict = JSON.parse(jsonMatch[0]) as {
          safe: boolean;
          reason: string;
        };

        if (!verdict.safe) {
          return await promptUserOrBlock(
            verdict.reason || "Action modifies state, cloud resources, or data.",
          );
        }
      } catch (err) {
        // Fail-safe: if the model fails or times out, prompt the user rather than failing open
        return await promptUserOrBlock(
          `Guard model check failed (${err instanceof Error ? err.message : String(err)}). Approval required.`,
        );
      }
    },
  );
}
