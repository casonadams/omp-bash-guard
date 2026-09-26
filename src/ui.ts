import type { BlockResult, ExtensionContext } from "./types";

export function formatCommandDisplay(command: string): string {
  const lines = command.split("\n");
  if (lines.length > 1) {
    const preview =
      lines.length <= 8 ? lines : [...lines.slice(0, 6), `... (${lines.length - 6} more lines)`];
    return `Command:\n${preview.map((l) => `  ${l}`).join("\n")}`;
  }
  const display = command.length > 100 ? `${command.slice(0, 97)}...` : command;
  return `Command: ${display}`;
}

async function requestFeedback(ctx?: ExtensionContext): Promise<string | undefined> {
  if (typeof ctx?.ui?.input !== "function") return undefined;
  const input = await ctx.ui.input(
    "Deny feedback for agent (optional — Enter to skip, Esc to cancel):",
    "e.g. use dry-run or target a different resource",
  );
  return input?.trim() || undefined;
}

export async function promptUser(
  ctx: ExtensionContext | undefined,
  command: string,
  reason: string,
): Promise<BlockResult | void> {
  if (!ctx?.hasUI) {
    return {
      block: true,
      reason: `[Bash Guard] Blocked unsafe command (headless mode): ${reason}`,
    };
  }

  const commandBlock = formatCommandDisplay(command);
  const promptTitle = `Bash Guard\n${commandBlock}\nSecurity Audit: ${reason}\nAllow execution?`;

  if (typeof ctx.ui?.select === "function") {
    const selected = await ctx.ui.select(promptTitle, ["Allow", "Deny with feedback"], {
      initialIndex: 1,
    });
    if (selected === "Allow") return;
    if (selected === "Deny with feedback") {
      const feedback = await requestFeedback(ctx);
      if (feedback)
        return { block: true, reason: `User denied execution with feedback: ${feedback}` };
    }
    return { block: true, reason: `User denied execution: ${reason}` };
  }

  if (typeof ctx.ui?.askDialog === "function") {
    const res = await ctx.ui.askDialog([
      {
        id: "bash_guard_approval",
        header: "Bash Guard",
        question: `${commandBlock}\n**Security Audit:** ${reason}\n**Allow execution?**`,
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
      const feedback = await requestFeedback(ctx);
      if (feedback)
        return { block: true, reason: `User denied execution with feedback: ${feedback}` };
    }
    return { block: true, reason: `User denied execution: ${reason}` };
  }

  if (typeof ctx.ui?.confirm === "function") {
    const approved = await ctx.ui.confirm(
      "⚠️ Sensitive / Unsafe Command Approval",
      `${commandBlock}\n\nSecurity Audit: ${reason}\n\nAllow execution?`,
    );
    if (approved) return;
    return { block: true, reason: `User denied execution: ${reason}` };
  }

  return { block: true, reason: `[Bash Guard] Blocked unsafe command (headless mode): ${reason}` };
}
