import type { BlockResult, ExtensionContext, ExtensionUIContext } from "./types";

// Terminal styling palette - customize colors here
export const THEME = {
  yellow: (text: string) => `\x1b[93;1m${text}\x1b[0m`,
  white: (text: string) => `\x1b[97;1m${text}\x1b[0m`,
  dim: (text: string) => `\x1b[90m${text}\x1b[0m`,
  bold: (text: string) => `\x1b[1m${text}\x1b[0m`,
};

// Formats a clean 1-line reference to the command (full script is already visible in chat transcript above)
export function formatCommandReference(command: string): string {
  const lines = command.trim().split("\n");
  const firstLine = lines[0].length > 70 ? `${lines[0].slice(0, 67)}...` : lines[0];

  if (lines.length > 1) {
    return `${THEME.dim("Target:")} ${THEME.white(firstLine)} ${THEME.dim(`(${lines.length} lines — see above)`)}`;
  }
  return `${THEME.dim("Target:")} ${THEME.white(firstLine)}`;
}

export const formatCommandDisplay = formatCommandReference;

// Declarative layout of the security alert dialog
export function formatSecurityPrompt(command: string, reason: string): string {
  const targetRef = formatCommandReference(command);
  return [
    THEME.yellow("Bash Guard"),
    THEME.dim("Security Audit:"),
    `  ${THEME.dim(reason)}`,
    "",
    targetRef,
    "",
    THEME.dim("Allow execution?"),
  ].join("\n");
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
        continue; // Esc loops back to menu
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
  command: string,
  reason: string,
): Promise<BlockResult | void> {
  if (typeof ui.askDialog !== "function") return undefined;

  const targetRef = formatCommandReference(command);
  const question = `**Security Audit:**\n${reason}\n\n${targetRef}\n\n**Allow execution?**`;

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

  if (typeof ctx.ui.select === "function") {
    const promptTitle = formatSecurityPrompt(command, reason);
    return await promptWithSelect(ctx.ui, promptTitle, reason);
  }

  if (typeof ctx.ui?.askDialog === "function") {
    return await promptWithAskDialog(ctx.ui, command, reason);
  }

  if (typeof ctx.ui?.confirm === "function") {
    const targetRef = formatCommandReference(command);
    const approved = await ctx.ui.confirm(
      "Sensitive / Unsafe Command Approval",
      `Security Audit:\n${reason}\n\n${targetRef}\n\nAllow execution?`,
    );
    if (approved) return;
    return { block: true, reason: `User denied execution: ${reason}` };
  }

  return { block: true, reason: `[Bash Guard] Blocked unsafe command (headless mode): ${reason}` };
}
