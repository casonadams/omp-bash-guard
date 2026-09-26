import { describe, expect, test } from "bun:test";
import registerBashGuard, { CRITICAL_DANGER_REGEX } from "../index";

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

  test("formats askDialog with single-paragraph question and Allow / Deny with feedback options", async () => {
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
    expect(questions[0]?.question).toContain("**Command:** `rm -rf /`");
    expect(questions[0]?.question).toContain("**Security Audit:**");
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
});
