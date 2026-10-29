// South African mobile numbers, normalised to E.164 +27 form.
// Accepts 0821234567, +27821234567, 27821234567, with spaces, dashes, dots or brackets,
// and repairs the common "+27 0…" typo. Anything else is not a dialable SA number.
export function normaliseSaPhone(value: string): string | null {
  const compact = value.replace(/[\s\-().]/g, "");
  if (/^0[0-9]{9}$/.test(compact)) return "+27" + compact.slice(1);
  if (/^27[0-9]{9}$/.test(compact)) return "+" + compact;
  if (/^\+270[0-9]{9}$/.test(compact)) return "+27" + compact.slice(4);
  if (/^\+27[0-9]{9}$/.test(compact)) return compact;
  return null;
}

export function isValidSaPhone(value: string): boolean {
  return normaliseSaPhone(value) !== null;
}

/** Returns the E.164 value, or the trimmed input when it is not a valid SA number. */
export function toSaPhone(value: string): string {
  return normaliseSaPhone(value) ?? value.trim();
}

export const SA_PHONE_MESSAGE = "Enter a South African number like +27821234567 or 0821234567.";
