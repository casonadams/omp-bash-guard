import type { Api, Model } from "@oh-my-pi/pi-ai";
import { describe, expect, test } from "bun:test";
import registerBashGuard, {
  CRITICAL_DANGER_REGEX,
  evaluateCommandSafety,
  formatCommandDisplay,
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

  test("uses ctx.ui.select for a compact 2-option prompt without Other or Recommended", async () => {
    let toolCallHandler: ((event: unknown, ctx: unknown) => Promise<unknown>) | undefined;
    const mockPi = {
      on: (_event: string, handler: (event: unknown, ctx: unknown) => Promise<unknown>) => {
        toolCallHandler = handler;
      },
    };

    registerBashGuard(mockPi as unknown as Parameters<typeof registerBashGuard>[0]);

    let selectTitle: string | undefined;
    let selectOptions: unknown;
    let selectConfig: unknown;
    const mockSelect = async (title: string, options: unknown, config: unknown) => {
      selectTitle = title;
      selectOptions = options;
      selectConfig = config;
      return "Allow";
    };

    const result = await toolCallHandler!(
      { toolName: "bash", input: { command: "rm -rf /" } },
      {
        hasUI: true,
        ui: {
          select: mockSelect,
        },
      },
    );

    expect(result).toBeUndefined(); // Allowed
    expect(selectTitle).toContain("Bash Guard");
    expect(selectTitle).toContain("Security Audit:");
    expect(selectTitle).toContain("Command:\n  rm -rf /");
    expect(selectTitle?.indexOf("Security Audit:")).toBeLessThan(
      selectTitle?.indexOf("Command:") ?? -1,
    );
    expect(selectOptions).toEqual(["Allow", "Deny with feedback"]);
    expect(selectConfig).toEqual({ initialIndex: 1 });
  });

  test("ctx.ui.select prompts for feedback when Deny with feedback is selected", async () => {
    let toolCallHandler: ((event: unknown, ctx: unknown) => Promise<unknown>) | undefined;
    const mockPi = {
      on: (_event: string, handler: (event: unknown, ctx: unknown) => Promise<unknown>) => {
        toolCallHandler = handler;
      },
    };

    registerBashGuard(mockPi as unknown as Parameters<typeof registerBashGuard>[0]);

    const mockSelect = async () => "Deny with feedback";
    const mockInput = async () => "run in sandbox instead";

    const result = await toolCallHandler!(
      { toolName: "bash", input: { command: "rm -rf /" } },
      {
        hasUI: true,
        ui: {
          select: mockSelect,
          input: mockInput,
        },
      },
    );

    expect(result).toEqual({
      block: true,
      reason: "User denied execution with feedback: run in sandbox instead",
    });
  });

  test("ctx.ui.select loops back to menu when Esc is pressed in feedback input", async () => {
    let toolCallHandler: ((event: unknown, ctx: unknown) => Promise<unknown>) | undefined;
    const mockPi = {
      on: (_event: string, handler: (event: unknown, ctx: unknown) => Promise<unknown>) => {
        toolCallHandler = handler;
      },
    };

    registerBashGuard(mockPi as unknown as Parameters<typeof registerBashGuard>[0]);

    let selectCount = 0;
    const mockSelect = async () => {
      selectCount++;
      // First pick "Deny with feedback", second time pick "Allow" after Esc
      return selectCount === 1 ? "Deny with feedback" : "Allow";
    };

    let inputCount = 0;
    const mockInput = async () => {
      inputCount++;
      // User pressed Esc (returns undefined)
      return undefined;
    };

    const result = await toolCallHandler!(
      { toolName: "bash", input: { command: "rm -rf /" } },
      {
        hasUI: true,
        ui: {
          select: mockSelect,
          input: mockInput,
        },
      },
    );

    expect(selectCount).toBe(2); // Looped back to menu!
    expect(inputCount).toBe(1);
    expect(result).toBeUndefined(); // Allowed on second attempt
  });

  test("formats askDialog fallback with single-paragraph question and Allow / Deny with feedback options", async () => {
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
        results: [{ selectedOptions: ["Allow"] }],
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
      question: string;
      options: Array<{ label: string; preview?: string }>;
    }>;
    expect(questions[0]?.question).toContain("**Security Audit:**");
    expect(questions[0]?.question).toContain("Command:\n  rm -rf /");
    expect(questions[0]?.question?.indexOf("**Security Audit:**")).toBeLessThan(
      questions[0]?.question?.indexOf("Command:") ?? -1,
    );
    expect(questions[0]?.question).toContain("**Allow execution?**");
    expect(questions[0]?.options).toEqual([{ label: "Allow" }, { label: "Deny with feedback" }]);
  });

  test("formats multiline commands directly in Command block without preview clutter", async () => {
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
        results: [{ selectedOptions: ["Allow"] }],
      };
    };

    const multilineCmd = "for pod in $(kubectl get pods); do\n  kubectl delete pod $pod\ndone";
    await toolCallHandler!(
      { toolName: "bash", input: { command: multilineCmd } },
      {
        hasUI: true,
        ui: {
          askDialog: mockAskDialog,
        },
      },
    );

    const questions = dialogArg as Array<{
      question: string;
      options: Array<{ label: string; preview?: string }>;
    }>;
    expect(questions[0]?.question).toContain("for pod in $(kubectl get pods); do");
    expect(questions[0]?.question).toContain("kubectl delete pod $pod");
    expect(questions[0]?.options[0]?.preview).toBeUndefined();
  });

  test("prompts for optional feedback when Deny with feedback is selected", async () => {
    let toolCallHandler: ((event: unknown, ctx: unknown) => Promise<unknown>) | undefined;
    const mockPi = {
      on: (_event: string, handler: (event: unknown, ctx: unknown) => Promise<unknown>) => {
        toolCallHandler = handler;
      },
    };

    registerBashGuard(mockPi as unknown as Parameters<typeof registerBashGuard>[0]);

    const mockAskDialog = async () => ({
      kind: "submit",
      results: [{ selectedOptions: ["Deny with feedback"] }],
    });

    let inputPromptAsked = false;
    const mockInput = async () => {
      inputPromptAsked = true;
      return "use dry-run mode";
    };

    const result = await toolCallHandler!(
      { toolName: "bash", input: { command: "rm -rf /" } },
      {
        hasUI: true,
        ui: {
          askDialog: mockAskDialog,
          input: mockInput,
        },
      },
    );

    expect(inputPromptAsked).toBe(true);
    expect(result).toEqual({
      block: true,
      reason: "User denied execution with feedback: use dry-run mode",
    });
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

describe("formatCommandDisplay", () => {
  test("formats single-line command with indentation", () => {
    expect(formatCommandDisplay("git status")).toBe("Command:\n  git status");
  });

  test("formats full multiline command without truncation", () => {
    const multiline =
      "echo 1\necho 2\necho 3\necho 4\necho 5\necho 6\necho 7\necho 8\necho 9\necho 10";
    const res = formatCommandDisplay(multiline);
    expect(res).toContain("echo 1");
    expect(res).toContain("echo 10");
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
