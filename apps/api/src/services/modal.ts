/** Server-only client for the private MzansiDrive Modal web app. */
export async function infer<T>(task: string, payload: unknown): Promise<T> {
  const baseUrl = process.env.MODAL_AI_URL;
  const token = process.env.MODAL_AI_TOKEN;
  if (!baseUrl || !token) throw new Error("Modal inference endpoint is not configured");
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/ai/${task}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(90_000),
  });
  if (!response.ok) {
    const message = await response.text().catch(() => "");
    throw new Error(`Modal inference request failed (${response.status}): ${message.slice(0, 300)}`);
  }
  return await response.json() as T;
}
