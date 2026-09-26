const TOKENS = new Set(["project_code", "service", "status", "latest_receipt"]);

export function validateDataHealthTemplate(value: unknown): { valid: true } | { valid: false; message: string } {
  if (value === null || value === undefined || String(value).trim() === "") return { valid: true };
  const text = String(value);
  if (text.includes("{{") !== text.includes("}}")) return { valid: false, message: "Data Health template has an unmatched placeholder brace." };
  for (const match of text.matchAll(/{{([^{}]*)}}/g)) {
    if (!TOKENS.has(match[1])) return { valid: false, message: `Data Health template placeholder {{${match[1]}}} is not supported.` };
  }
  return { valid: true };
}
