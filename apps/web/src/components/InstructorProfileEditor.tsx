"use client";
import { FormEvent, useState } from "react";
import { isValidSaPhone, normaliseSaPhone, SA_PHONE_MESSAGE } from "@/lib/sa-phone";

type Profile = Record<string, any>;

// The nine-step wizard owns documents, packages and verification; this form only touches the
// basics an approved instructor should be able to correct at any time.
export default function InstructorProfileEditor({ initial }: { initial: Profile }) {
  const [form, setForm] = useState<Profile>({
    full_name: initial.full_name ?? "",
    phone: initial.phone ?? "",
    city: initial.city ?? "",
    bio: initial.bio ?? "",
    experience_years: initial.experience_years ?? 0,
    hourly_rate: initial.hourly_rate ?? 0,
    languages: Array.isArray(initial.languages) ? initial.languages.join(", ") : "",
    vehicle_make: initial.vehicle_make ?? "",
    vehicle_model: initial.vehicle_model ?? "",
    transmission: initial.transmission ?? "manual",
  });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState(false);

  const set = (key: string, value: unknown) => setForm(current => ({ ...current, [key]: value }));

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setError(""); setNotice("");
    try {
      const fullName = String(form.full_name ?? "").trim();
      const phone = String(form.phone ?? "").trim();
      const city = String(form.city ?? "").trim();
      if (fullName.length < 2) throw new Error("Enter your full name as learners should see it.");
      if (phone && !isValidSaPhone(phone)) throw new Error(SA_PHONE_MESSAGE);

      const payload: Profile = {
        full_name: fullName,
        bio: String(form.bio ?? "").trim(),
        experience_years: Math.max(0, Number(form.experience_years) || 0),
        hourly_rate: Math.max(0, Number(form.hourly_rate) || 0),
        languages: String(form.languages ?? "").split(",").map(value => value.trim()).filter(Boolean),
        vehicle_make: String(form.vehicle_make ?? "").trim(),
        vehicle_model: String(form.vehicle_model ?? "").trim(),
        transmission: ["manual", "automatic", "both"].includes(String(form.transmission)) ? form.transmission : undefined,
        // city is a GSI key: an empty value means "leave it as it is" on the API, so only send it when set.
        ...(phone ? { phone: normaliseSaPhone(phone) } : {}),
        ...(city ? { city } : {}),
      };

      const response = await fetch("/api/backend/v1/instructors/me/profile", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? "Could not save your profile.");
      setNotice("Profile saved. Your marketplace listing now shows these details.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save your profile.");
    } finally {
      setBusy(false);
    }
  }

  async function restart() {
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/backend/v1/instructors/me/onboarding/restart", { method: "POST" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? "Could not restart onboarding.");
      window.location.assign("/instructor/onboarding");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not restart onboarding.");
      setBusy(false); setConfirming(false);
    }
  }

  return <>
  <section className="status-card">
    <div className="auth-eyebrow">PROFILE SETTINGS</div>
    <h2>Edit your basics</h2>
    <p>These details appear on your public listing and in search results. Documents, verification and lesson packages are managed in onboarding.</p>
    {notice && <p className="instructor-notice" role="status">{notice}</p>}
    {error && <p className="booking-error" role="alert">{error}</p>}
    <form className="instructor-form" onSubmit={save}>
      <label>Full name<input required minLength={2} maxLength={120} value={form.full_name} onChange={e => set("full_name", e.target.value)} /></label>
      <label>Phone number<input value={form.phone} onChange={e => set("phone", e.target.value)} placeholder="0821234567 or +27821234567" /></label>
      <label>City<input maxLength={100} value={form.city} onChange={e => set("city", e.target.value)} placeholder="e.g. Johannesburg" /></label>
      <label>Hourly rate (ZAR)<input type="number" min={0} max={10000} value={form.hourly_rate} onChange={e => set("hourly_rate", e.target.value)} /></label>
      <label>Years of experience<input type="number" min={0} max={80} value={form.experience_years} onChange={e => set("experience_years", e.target.value)} /></label>
      <label>Languages<input value={form.languages} onChange={e => set("languages", e.target.value)} placeholder="English, isiZulu, Afrikaans" /></label>
      <label>Vehicle make<input maxLength={100} value={form.vehicle_make} onChange={e => set("vehicle_make", e.target.value)} placeholder="Toyota" /></label>
      <label>Vehicle model<input maxLength={100} value={form.vehicle_model} onChange={e => set("vehicle_model", e.target.value)} placeholder="Corolla Quest" /></label>
      <label>Transmission<select value={form.transmission} onChange={e => set("transmission", e.target.value)}><option value="manual">Manual</option><option value="automatic">Automatic</option><option value="both">Both</option></select></label>
      <label className="wide">Bio<textarea maxLength={2000} value={form.bio} onChange={e => set("bio", e.target.value)} placeholder="Tell learners how you teach and what to expect in the car." /></label>
      <button disabled={busy}>{busy ? "Saving…" : "Save profile"}</button>
    </form>
    <p className="instructor-muted">Your verification status and approved documents are not affected by these edits.</p>
  </section>
  <section className="status-card">
    <div className="auth-eyebrow">RE-VERIFICATION</div>
    <h2>Restart onboarding from scratch</h2>
    <p>Use this when something material changed — your vehicle, city, rates or documents — and you want it re-checked. Your wizard reopens at step 1, your listing is hidden from learners, and your dashboard stays locked until you submit again and an administrator re-approves you. What you have already entered stays in place, so you only re-enter the parts that changed.</p>
    {confirming ? <div className="instructor-actions">
      <button disabled={busy} onClick={restart}>{busy ? "Restarting…" : "Yes, restart my onboarding"}</button>
      <button disabled={busy} onClick={() => setConfirming(false)}>Cancel</button>
    </div> : <div className="instructor-actions"><button disabled={busy} onClick={() => setConfirming(true)}>Restart onboarding…</button></div>}
  </section>
  </>;
}
