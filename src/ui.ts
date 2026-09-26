import type { BlockResult, ExtensionContext, ExtensionUIContext } from "./types";

export function formatCommandDisplay(command: string): string {
  const lines = command.split("\n");
  if (lines.length > 1) {
    return `Command:\n${lines.map((l) => `  ${l}`).join("\n")}`;
  }
  return `Command:\n  ${command}`;
}

async function promptWithSelect(
  ui: ExtensionUIContext,
  promptTitle: string,
  reason: string,
): Promise<BlockResult | void> {
  if (typeof ui.select !== "function") return undefined;

  while (true) {
    const selected = await ui.select(promptTitle, ["Allow", "Deny with feedback"], {
      initialIndex: 1,
    });

    if (selected === "Allow") {
      return;
    }

    if (selected === "Deny with feedback" && typeof ui.input === "function") {
      const input = await ui.input(
        "Deny feedback for agent (Enter to submit, Esc to go back):",
        "e.g. use dry-run or target a different resource",
      );
      if (input === undefined) {
        continue;
      }
      const feedback = input.trim();
      return {
        block: true,
        reason: feedback
          ? `User denied execution with feedback: ${feedback}`
          : `User denied execution: ${reason}`,
      };
    }

    return { block: true, reason: `User denied execution: ${reason}` };
  }
}

async function promptWithAskDialog(
  ui: ExtensionUIContext,
  question: string,
  reason: string,
): Promise<BlockResult | void> {
  if (typeof ui.askDialog !== "function") return undefined;

  const res = await ui.askDialog([
    {
      id: "bash_guard_approval",
      header: "Bash Guard",
      question,
      options: [{ label: "Allow" }, { label: "Deny with feedback" }],
    },
  ]);

  if (res?.kind === "submit") {
    if (res.results[0]?.selectedOptions[0] === "Allow") return;
    if (res.results[0]?.customInput) {
      return {
        block: true,
        reason: `User denied execution with feedback: ${res.results[0].customInput}`,
      };
    }
    if (
      res.results[0]?.selectedOptions[0] === "Deny with feedback" &&
      typeof ui.input === "function"
    ) {
      const input = await ui.input(
        "Deny feedback for agent (Enter to submit, Esc to skip):",
        "e.g. use dry-run or target a different resource",
      );
      if (input !== undefined && input.trim()) {
        return { block: true, reason: `User denied execution with feedback: ${input.trim()}` };
      }
    }
  }

  return { block: true, reason: `User denied execution: ${reason}` };
}

export async function promptUser(
  ctx: ExtensionContext | undefined,
  command: string,
  reason: string,
): Promise<BlockResult | void> {
  if (!ctx?.hasUI || !ctx.ui) {
    return {
      block: true,
      reason: `[Bash Guard] Blocked unsafe command (headless mode): ${reason}`,
    };
  }

  const commandBlock = formatCommandDisplay(command);

  if (typeof ctx.ui.select === "function") {
    const promptTitle = `Bash Guard\nSecurity Audit:\n  ${reason}\n\n${commandBlock}\n\nAllow execution?`;
    return await promptWithSelect(ctx.ui, promptTitle, reason);
  }

  if (typeof ctx.ui.askDialog === "function") {
    const question = `**Security Audit:**\n${reason}\n\n${commandBlock}\n\n**Allow execution?**`;
    return await promptWithAskDialog(ctx.ui, question, reason);
  }

  if (typeof ctx.ui.confirm === "function") {
    const approved = await ctx.ui.confirm(
      "⚠️ Sensitive / Unsafe Command Approval",
      `Security Audit:\n${reason}\n\n${commandBlock}\n\nAllow execution?`,
    );
    if (approved) return;
    return { block: true, reason: `User denied execution: ${reason}` };
  }

  return { block: true, reason: `[Bash Guard] Blocked unsafe command (headless mode): ${reason}` };
}
