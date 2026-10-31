"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.infer = infer;
/** Server-only client for the private iDriveMzansi Modal web app. */
async function infer(task, payload) {
    const baseUrl = process.env.MODAL_AI_URL;
    const token = process.env.MODAL_AI_TOKEN;
    if (!baseUrl || !token)
        throw new Error("Modal inference endpoint is not configured");
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
    return await response.json();
}
