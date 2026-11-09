/** Documented Responses effort support; unknown models use the server default.
 * https://developers.openai.com/api/docs/guides/latest-model
 * https://developers.openai.com/api/docs/guides/reasoning
 */
export function chatGPTEfforts(model: string): string[] {
  if (["gpt-6.1-sol", "gpt-6-astra"].includes(model)) return ["low", "medium", "high", "xhigh", "max"];
  if (["gpt-6.1-terra", "gpt-6-sol", "gpt-6-luna", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"].includes(model)) return ["none", "low", "medium", "high", "xhigh", "max"];
  return [];
}
export function chatGPTEffort(model: string, effort?: string): string | undefined {
  return effort && chatGPTEfforts(model).includes(effort) ? effort : undefined;
}
