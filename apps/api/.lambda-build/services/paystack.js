"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PAYSTACK_CHANNELS = exports.fromMinorUnits = exports.toMinorUnits = void 0;
exports.paystack = paystack;
exports.verifyWebhook = verifyWebhook;
const node_crypto_1 = require("node:crypto");
const apiBase = "https://api.paystack.co";
function secret() {
    const key = process.env.PAYSTACK_SECRET_KEY;
    if (!key)
        throw new Error("Paystack is not configured");
    return key;
}
async function paystack(path, body, method = "POST") {
    const response = await fetch(apiBase + path, {
        method,
        headers: { Authorization: `Bearer ${secret()}`, "Content-Type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const result = await response.json();
    if (!response.ok || result.status !== true)
        throw new Error(`Paystack request failed: ${result.message ?? response.statusText}`);
    return result.data;
}
function verifyWebhook(rawBody, signature) {
    const key = process.env.PAYSTACK_SECRET_KEY;
    if (!key || !signature || !/^[a-f0-9]{64}$/i.test(signature))
        return false;
    const expected = (0, node_crypto_1.createHmac)("sha512", key).update(rawBody).digest();
    const provided = Buffer.from(signature, "hex");
    return provided.length === expected.length && (0, node_crypto_1.timingSafeEqual)(provided, expected);
}
const toMinorUnits = (zar) => Math.round(zar * 100);
exports.toMinorUnits = toMinorUnits;
const fromMinorUnits = (minor) => minor / 100;
exports.fromMinorUnits = fromMinorUnits;
exports.PAYSTACK_CHANNELS = ["card", "bank", "ussd", "qr", "mobile_money", "bank_transfer", "eft"];
