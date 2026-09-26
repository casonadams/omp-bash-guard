import type { BlockResult, ExtensionContext, ExtensionUIContext } from "./types";

// Terminal styling palette - customize colors here
export const THEME = {
  yellow: (text: string) => `\x1b[93;1m${text}\x1b[0m`,
  dim: (text: string) => `\x1b[90m${text}\x1b[0m`,
  bold: (text: string) => `\x1b[1m${text}\x1b[0m`,
  fg: (text: string) => text,
};

// Formats the command block (handles single-line and multiline scripts)
export function formatCommandDisplay(command: string): string {
  const lines = command.split("\n");
  const prefix = (line: string, isFirst: boolean) =>
    isFirst ? `  ${THEME.dim("$")} ${THEME.yellow(line)}` : `    ${THEME.yellow(line)}`;

  if (lines.length <= 1) {
    return `${THEME.dim("Command:")}\n${prefix(command, true)}`;
  }

  if (lines.length <= 16) {
    const formatted = lines.map((line, i) => prefix(line, i === 0)).join("\n");
    return `${THEME.dim("Command:")}\n${formatted}`;
  }

  // Large multiline scripts: show first 12 lines + truncation notice + last 3 lines
  const head = lines.slice(0, 12).map((l, i) => prefix(l, i === 0));
  const notice = `  ${THEME.dim(`... (${lines.length - 15} lines truncated; total ${lines.length} lines) ...`)}`;
  const tail = lines.slice(-3).map((l) => prefix(l, false));

  return `${THEME.dim("Command:")}\n${head.join("\n")}\n${notice}\n${tail.join("\n")}`;
}

// Declarative layout of the security alert dialog
export function formatSecurityPrompt(command: string, reason: string): string {
  const commandBlock = formatCommandDisplay(command);
  return [
    THEME.yellow("Bash Guard"),
    THEME.dim("Security Audit:"),
    `  ${THEME.fg(reason)}`,
    "",
    commandBlock,
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

  const commandBlock = formatCommandDisplay(command);
  const question = `**Security Audit:**\n${reason}\n\n${commandBlock}\n\n**Allow execution?**`;

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
    const commandBlock = formatCommandDisplay(command);
    const approved = await ctx.ui.confirm(
      "Sensitive / Unsafe Command Approval",
      `Security Audit:\n${reason}\n\n${commandBlock}\n\nAllow execution?`,
    );
    if (approved) return;
    return { block: true, reason: `User denied execution: ${reason}` };
  }

  return { block: true, reason: `[Bash Guard] Blocked unsafe command (headless mode): ${reason}` };
}
