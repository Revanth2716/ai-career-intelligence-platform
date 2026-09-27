/**
 * PII protection: masks emails, phone numbers and URLs before text is sent
 * to LLM providers or written to logs. Applied at the tracking/provider
 * layer (structural, not per-call-site) so no code path can forget it.
 */

const PATTERNS: Array<[RegExp, string]> = [
  [/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[EMAIL]'],
  [/(\+?\d[\d\s().-]{7,}\d)/g, '[PHONE]'],
  [/https?:\/\/[^\s<>"')]+/g, '[URL]'],
];

export function maskPii(text: string): string {
  return PATTERNS.reduce((acc, [pattern, replacement]) => acc.replace(pattern, replacement), text);
}
