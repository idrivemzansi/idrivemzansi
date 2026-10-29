import { createHmac, timingSafeEqual } from "node:crypto";

const apiBase = "https://api.paystack.co";
function secret() {
  const key = process.env.PAYSTACK_SECRET_KEY;
  if (!key) throw new Error("Paystack is not configured");
  return key;
}
export async function paystack<T = any>(path: string, body?: unknown, method = "POST"): Promise<T> {
  const response = await fetch(apiBase + path, {
    method,
    headers: { Authorization: `Bearer ${secret()}`, "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const result = await response.json() as { status?: boolean; message?: string; data?: T };
  if (!response.ok || result.status !== true) throw new Error(`Paystack request failed: ${result.message ?? response.statusText}`);
  return result.data as T;
}
export function verifyWebhook(rawBody: Buffer, signature: string | undefined) {
  const key = process.env.PAYSTACK_SECRET_KEY;
  if (!key || !signature || !/^[a-f0-9]{64}$/i.test(signature)) return false;
  const expected = createHmac("sha512", key).update(rawBody).digest();
  const provided = Buffer.from(signature, "hex");
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}
export const toMinorUnits = (zar: number) => Math.round(zar * 100);
export const fromMinorUnits = (minor: number) => minor / 100;
export const PAYSTACK_CHANNELS = ["card", "bank", "ussd", "qr", "mobile_money", "bank_transfer", "eft"] as const;
