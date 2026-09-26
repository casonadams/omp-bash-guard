import type { Api, Model } from "@oh-my-pi/pi-ai";
import { describe, expect, test } from "bun:test";
import registerBashGuard, {
  CRITICAL_DANGER_REGEX,
  evaluateCommandSafety,
  parseGuardOutput,
  resolveGuardModel,
} from "../index";
describe("CRITICAL_DANGER_REGEX", () => {
  test("flags destructive wipes immediately", () => {
    expect(CRITICAL_DANGER_REGEX.test("rm -rf /")).toBe(true);
    expect(CRITICAL_DANGER_REGEX.test("rm -rf ~")).toBe(true);
    expect(CRITICAL_DANGER_REGEX.test("rm -rf *")).toBe(true);
    expect(CRITICAL_DANGER_REGEX.test("rm -rf ..")).toBe(true);
    expect(CRITICAL_DANGER_REGEX.test("git reset --hard HEAD~1")).toBe(true);
    expect(CRITICAL_DANGER_REGEX.test("git clean -fd")).toBe(true);
    expect(CRITICAL_DANGER_REGEX.test("mkfs.ext4 /dev/sdb")).toBe(true);
    expect(CRITICAL_DANGER_REGEX.test("kubectl delete ns production")).toBe(true);
    expect(CRITICAL_DANGER_REGEX.test("psql -c 'DROP DATABASE production;'")).toBe(true);
  });

  test("does not match benign non-critical commands", () => {
    expect(CRITICAL_DANGER_REGEX.test("git status")).toBe(false);
    expect(CRITICAL_DANGER_REGEX.test("cargo check")).toBe(false);
    expect(CRITICAL_DANGER_REGEX.test("rm this.me")).toBe(false);
    expect(CRITICAL_DANGER_REGEX.test("rm -rf ./target")).toBe(false);
    expect(CRITICAL_DANGER_REGEX.test("bun test")).toBe(false);
  });
});

describe("registerBashGuard", () => {
  test("registers a tool_call event listener", () => {
    let registeredEvent: string | undefined;
    const mockPi = {
      on: (event: string) => {
        registeredEvent = event;
      },
    };

    registerBashGuard(mockPi as unknown as Parameters<typeof registerBashGuard>[0]);
    expect(registeredEvent).toBe("tool_call");
  });

  test("blocks immediately if no guard or judge model configured", async () => {
    let toolCallHandler: ((event: unknown, ctx: unknown) => Promise<unknown>) | undefined;
    const mockPi = {
      on: (_event: string, handler: (event: unknown, ctx: unknown) => Promise<unknown>) => {
        toolCallHandler = handler;
      },
    };

    registerBashGuard(mockPi as unknown as Parameters<typeof registerBashGuard>[0]);

    const result = await toolCallHandler!(
      { toolName: "bash", input: { command: "echo hello" } },
      {
        hasUI: false,
        models: {
          resolve: () => undefined,
        },
      },
    );

    expect(result).toEqual({
      block: true,
      reason:
        "[Bash Guard] Blocked unsafe command (headless mode): No guard or judge model configured! Set `modelRoles.guard: <provider/model>` (or `modelRoles.judge`) in ~/.omp/agent/config.yml before executing shell commands.",
    });
  });
  test("presents askDialog with question, recommended Cancel, and Proceed preview with scroller", async () => {
    let toolCallHandler: ((event: unknown, ctx: unknown) => Promise<unknown>) | undefined;
    const mockPi = {
      on: (_event: string, handler: (event: unknown, ctx: unknown) => Promise<unknown>) => {
        toolCallHandler = handler;
      },
    };

    registerBashGuard(mockPi as unknown as Parameters<typeof registerBashGuard>[0]);

    let dialogArg: unknown;
    const mockAskDialog = async (questions: unknown) => {
      dialogArg = questions;
      return {
        kind: "submit",
        results: [{ selectedOptions: ["Proceed"] }],
      };
    };

    const result = await toolCallHandler!(
      { toolName: "bash", input: { command: "rm -rf /" } },
      {
        hasUI: true,
        ui: {
          askDialog: mockAskDialog,
        },
      },
    );

    expect(result).toBeUndefined(); // Allowed to proceed
    expect(Array.isArray(dialogArg)).toBe(true);
    const questions = dialogArg as Array<{
      header?: string;
      question: string;
      recommended?: number;
      options: Array<{ label: string; description?: string; preview?: string }>;
    }>;
    expect(questions[0]?.header).toBe("Bash Guard");
    expect(questions[0]?.question).toContain("Security Audit:");
    expect(questions[0]?.question).toContain("Allow execution?");
    expect(questions[0]?.recommended).toBe(1);
    expect(questions[0]?.options[0]?.label).toBe("Proceed");
    expect(questions[0]?.options[0]?.preview).toBe("```bash\nrm -rf /\n```");
    expect(questions[0]?.options[1]?.label).toBe("Cancel");
  });
  test("blocks execution when askDialog is cancelled", async () => {
    let toolCallHandler: ((event: unknown, ctx: unknown) => Promise<unknown>) | undefined;
    const mockPi = {
      on: (_event: string, handler: (event: unknown, ctx: unknown) => Promise<unknown>) => {
        toolCallHandler = handler;
      },
    };

    registerBashGuard(mockPi as unknown as Parameters<typeof registerBashGuard>[0]);

    const mockAskDialog = async () => ({
      kind: "submit",
      results: [{ selectedOptions: ["Cancel"] }],
    });

    const result = await toolCallHandler!(
      { toolName: "bash", input: { command: "rm -rf /" } },
      {
        hasUI: true,
        ui: {
          askDialog: mockAskDialog,
        },
      },
    );

    expect(result).toEqual({
      block: true,
      reason:
        "User denied execution: Critical destructive or irreversible infrastructure action detected.",
    });
  });

  test("blocks execution with feedback when user provides custom input via Other", async () => {
    let toolCallHandler: ((event: unknown, ctx: unknown) => Promise<unknown>) | undefined;
    const mockPi = {
      on: (_event: string, handler: (event: unknown, ctx: unknown) => Promise<unknown>) => {
        toolCallHandler = handler;
      },
    };

    registerBashGuard(mockPi as unknown as Parameters<typeof registerBashGuard>[0]);

    const mockAskDialog = async () => ({
      kind: "submit",
      results: [{ selectedOptions: [], customInput: "don't delete production" }],
    });

    const result = await toolCallHandler!(
      { toolName: "bash", input: { command: "rm -rf /" } },
      {
        hasUI: true,
        ui: {
          askDialog: mockAskDialog,
        },
      },
    );

    expect(result).toEqual({
      block: true,
      reason: "User denied execution with feedback: don't delete production",
    });
  });

  test("falls back to confirm when select and askDialog are not available", async () => {
    let toolCallHandler: ((event: unknown, ctx: unknown) => Promise<unknown>) | undefined;
    const mockPi = {
      on: (_event: string, handler: (event: unknown, ctx: unknown) => Promise<unknown>) => {
        toolCallHandler = handler;
      },
    };

    registerBashGuard(mockPi as unknown as Parameters<typeof registerBashGuard>[0]);

    let confirmed = false;
    const mockConfirm = async () => {
      confirmed = true;
      return true;
    };

    const result = await toolCallHandler!(
      { toolName: "bash", input: { command: "rm -rf /" } },
      {
        hasUI: true,
        ui: {
          confirm: mockConfirm,
        },
      },
    );

    expect(confirmed).toBe(true);
    expect(result).toBeUndefined(); // Allowed by confirm
  });

  test("falls back to confirm denial when user declines", async () => {
    let toolCallHandler: ((event: unknown, ctx: unknown) => Promise<unknown>) | undefined;
    const mockPi = {
      on: (_event: string, handler: (event: unknown, ctx: unknown) => Promise<unknown>) => {
        toolCallHandler = handler;
      },
    };

    registerBashGuard(mockPi as unknown as Parameters<typeof registerBashGuard>[0]);

    const mockConfirm = async () => false;

    const result = await toolCallHandler!(
      { toolName: "bash", input: { command: "rm -rf /" } },
      {
        hasUI: true,
        ui: {
          confirm: mockConfirm,
        },
      },
    );

    expect(result).toEqual({
      block: true,
      reason:
        "User denied execution: Critical destructive or irreversible infrastructure action detected.",
    });
  });
});

describe("resolveGuardModel", () => {
  test("resolves guard model when available", async () => {
    const mockModel = { id: "test-model", provider: "ollama", api: "local-inference" } as const;
    const res = await resolveGuardModel({
      models: {
        resolve: (role: string) =>
          role === "@guard" ? (mockModel as unknown as Model<Api>) : undefined,
      },
    });
    expect("model" in res).toBe(true);
  });

  test("fails when non-local model lacks API key", async () => {
    const mockModel = { id: "gpt-4", provider: "openai", api: "openai-chat" } as const;
    const res = await resolveGuardModel({
      models: { resolve: () => mockModel as unknown as Model<Api> },
      modelRegistry: { getApiKey: async () => undefined },
    });
    expect(res).toEqual({
      block: true,
      reason: 'Guard model "openai/gpt-4" requires an API key, but none was found.',
    });
  });
});

describe("evaluateCommandSafety", () => {
  test("returns safe: false on invalid JSON or model failure", async () => {
    const mockModel = { id: "broken", provider: "test", api: "broken-api" } as const;
    const res = await evaluateCommandSafety(mockModel as unknown as Model<Api>, undefined, "ls");
    expect(res.safe).toBe(false);
    expect(res.reason).toContain("Guard model check failed");
  });
});

describe("parseGuardOutput", () => {
  test("parses clean JSON format", () => {
    const res = parseGuardOutput('{"safe": true, "reason": "read-only"}');
    expect(res).toEqual({ safe: true, reason: "read-only" });
  });

  test("strips thinking tags and parses wrapped JSON", () => {
    const res = parseGuardOutput(
      '<think>Evaluating...</think>\n{"safe": false, "reason": "deletes cluster pod"}',
    );
    expect(res).toEqual({ safe: false, reason: "deletes cluster pod" });
  });

  test("recovers from malformed JSON quotes inside reason", () => {
    const res = parseGuardOutput('{"safe": false, "reason": "Command "kubectl" is unsafe"}');
    expect(res.safe).toBe(false);
    expect(res.reason).toContain("kubectl");
  });

  test("recovers safely from plain prose without throwing", () => {
    const res = parseGuardOutput(
      "UNSAFE: This command mutates cluster state by terminating a running pod.",
    );
    expect(res.safe).toBe(false);
    expect(res.reason).toContain("mutates cluster state");
  });
});
