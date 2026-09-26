import { completeSimple, type Api, type Model } from "@oh-my-pi/pi-ai";
import { GUARD_SYSTEM_PROMPT } from "./constants";
import type { ExtensionContext } from "./types";

export type GuardModelResolution =
  { model: Model<Api>; apiKey?: string } | { block: true; reason: string };

export async function resolveGuardModel(ctx?: ExtensionContext): Promise<GuardModelResolution> {
  const model = ctx?.models?.resolve("@guard") ?? ctx?.models?.resolve("@judge");
  if (!model) {
    return {
      block: true,
      reason:
        "No guard or judge model configured! Set `modelRoles.guard: <provider/model>` (or `modelRoles.judge`) in ~/.omp/agent/config.yml before executing shell commands.",
    };
  }

  const apiKey = await ctx?.modelRegistry?.getApiKey(model).catch(() => undefined);
  if (!apiKey && model.api !== "local-inference" && model.provider !== "ollama") {
    return {
      block: true,
      reason: `Guard model "${model.provider}/${model.id}" requires an API key, but none was found.`,
    };
  }

  return { model, apiKey };
}

export async function evaluateCommandSafety(
  model: Model<Api>,
  apiKey: string | undefined,
  command: string,
): Promise<{ safe: boolean; reason: string }> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4000);

    const response = await completeSimple(
      model,
      {
        systemPrompt: [GUARD_SYSTEM_PROMPT],
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `<command_to_evaluate>\n${command}\n</command_to_evaluate>`,
              },
            ],
            timestamp: Date.now(),
          },
        ],
      },
      { apiKey, signal: controller.signal, temperature: 0.0, maxTokens: 256 },
    );
    clearTimeout(timeoutId);

    const textBlock = response.content.find(
      (b): b is { type: "text"; text: string } => b.type === "text" && typeof b.text === "string",
    );
    if (!textBlock) throw new Error("No text response received from guard model");

    const jsonMatch = textBlock.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("Invalid non-JSON response from guard model");

    return JSON.parse(jsonMatch[0]) as { safe: boolean; reason: string };
  } catch (err) {
    return {
      safe: false,
      reason: `Guard model check failed (${err instanceof Error ? err.message : String(err)}). Approval required.`,
    };
  }
}
