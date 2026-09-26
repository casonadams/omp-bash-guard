import { readFileSync } from "fs";

export const CRITICAL_DANGER_REGEX =
  /(\brm\s+-[a-zA-Z]*r[a-zA-Z]*f?\s+([/~]|\.\.|\*)|mkfs|dd\s+if=|>+\s*\/dev\/sd|:\(\)\s*\{\s*:\|:&\s*\};:|chmod\s+-[a-zA-Z]*R\s+777|\bgit\s+clean\s+-[a-zA-Z]*f[a-zA-Z]*d|\bgit\s+reset\s+--hard\b|\bpsql\b.*(DROP\s+(DATABASE|SCHEMA|TABLE)|TRUNCATE\b|DELETE\s+FROM\b|ALTER\s+(TABLE|ROLE)\b)|\bkubectl\s+(delete\s+(all|namespace|ns\b)|drain\b|cordon\b)|\bgcloud\s+.*delete\b|\bgcloud\s+iam\s+.*delete)/i;

export const GUARD_SYSTEM_PROMPT = readFileSync(
  new URL("../prompt.md", import.meta.url),
  "utf8",
).trim();
