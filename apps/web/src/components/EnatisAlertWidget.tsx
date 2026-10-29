"use client";

import { useState } from "react";
import { Bell, CheckCircle2, MapPin, Phone, ShieldCheck, Sparkles, Send } from "lucide-react";

const provinces = [
  "Gauteng",
  "Western Cape",
  "KwaZulu-Natal",
  "Eastern Cape",
  "Free State",
  "Limpopo",
  "Mpumalanga",
  "North West",
  "Northern Cape",
];

const popularCentres: Record<string, string[]> = {
  Gauteng: ["Langlaagte", "Randburg", "Centurion", "Waltloo", "Mabopane", "Kempton Park", "Midrand"],
  "Western Cape": ["Gallows Hill", "Green Point", "Maitland", "Ottery", "Goodwood", "Bellville"],
  "KwaZulu-Natal": ["Pinetown", "Rossburgh", "Winkelspruit", "Etwatwa", "Durban Central"],
  "Eastern Cape": ["Gqeberha (Port Elizabeth)", "East London", "Mthatha"],
  "Free State": ["Bloemfontein", "Welkom"],
};

export default function EnatisAlertWidget() {
  const [province, setProvince] = useState("Gauteng");
  const [testCentre, setTestCentre] = useState("");
  const [contact, setContact] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");

  const centres = popularCentres[province] ?? ["Main Regional DLTC"];

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!contact.trim()) {
      setError("Please enter your email or WhatsApp number.");
      return;
    }

    setSubmitting(true);
    setError("");

    try {
      const res = await fetch("/api/backend/v1/enatis/alert-lead", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contact: contact.trim(),
          province,
          test_centre: testCentre || "Any available centre",
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error ?? "Could not save alert preferences.");
      }

      setSubmitted(true);
    } catch (err: any) {
      setError(err.message ?? "Something went wrong. Please retry.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="enatis-widget-container">
      <div className="enatis-widget-card">
        <div className="enatis-widget-info">
          <div className="eyebrow">
            <span className="eyebrow-dot" /> LIVE DLTC RADAR
          </div>
          <h2>Never miss an open eNaTIS test slot.</h2>
          <p>
            Driving licence test slots disappear in seconds. We continuously monitor South African DLTC test centres
            and alert you the moment a slot opens or gets cancelled.
          </p>

          <div className="enatis-perks">
            <div className="enatis-perk">
              <CheckCircle2 size={16} className="perk-icon" />
              <span>Instant alerts sent via WhatsApp or Email</span>
            </div>
            <div className="enatis-perk">
              <CheckCircle2 size={16} className="perk-icon" />
              <span>Includes Langlaagte, Gallows Hill, Randburg & Pinetown</span>
            </div>
            <div className="enatis-perk">
              <CheckCircle2 size={16} className="perk-icon" />
              <span>100% Free · Zero spam · Unsubscribe anytime</span>
            </div>
          </div>
        </div>

        <div className="enatis-widget-form-wrap">
          {submitted ? (
            <div className="enatis-success-card">
              <div className="success-icon-badge">
                <CheckCircle2 size={32} />
              </div>
              <h3>Alert activated!</h3>
              <p>
                We have registered your radar for <b>{province}</b> {testCentre ? `(${testCentre})` : "(All centres)"}.
                Watch your inbox / WhatsApp for instant notifications when test slots drop.
              </p>
              <button
                type="button"
                className="secondary-btn"
                onClick={() => {
                  setSubmitted(false);
                  setContact("");
                }}
              >
                Set up another alert
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="enatis-form">
              <h4>Get Free DLTC Slot Alerts</h4>

              {error && <div className="form-error-banner">{error}</div>}

              <label className="field-label">
                <MapPin size={13} /> Select Province
                <select
                  value={province}
                  onChange={e => {
                    setProvince(e.target.value);
                    setTestCentre("");
                  }}
                  className="enatis-select"
                >
                  {provinces.map(p => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
              </label>

              <label className="field-label">
                Preferred Test Centre (Optional)
                <select
                  value={testCentre}
                  onChange={e => setTestCentre(e.target.value)}
                  className="enatis-select"
                >
                  <option value="">Any DLTC in {province}</option>
                  {centres.map(c => (
                    <option key={c} value={c}>{c} DLTC</option>
                  ))}
                </select>
              </label>

              <label className="field-label">
                <Phone size={13} /> WhatsApp Number or Email
                <input
                  type="text"
                  placeholder="e.g. 082 123 4567 or you@email.com"
                  value={contact}
                  onChange={e => setContact(e.target.value)}
                  className="enatis-input"
                  required
                />
              </label>

              <button type="submit" disabled={submitting} className="enatis-submit-btn">
                {submitting ? "Activating radar…" : (
                  <>
                    <Bell size={15} /> Turn on test slot alerts
                  </>
                )}
              </button>

              <small className="privacy-microcopy">
                <ShieldCheck size={12} /> Respects your privacy. Protected under POPIA.
              </small>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
