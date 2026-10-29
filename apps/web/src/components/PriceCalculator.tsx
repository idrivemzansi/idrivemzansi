"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Calculator, Check, MapPin, ShieldCheck, Star, Users } from "lucide-react";

type LessonPackage = { name?: string; lesson_count: number; price: number; lesson_type?: string };

type Instructor = {
  user_id: string;
  full_name: string;
  city?: string;
  suburbs_covered?: string[];
  transmission?: string;
  hourly_rate: number;
  avg_rating?: number;
  rating?: number;
  review_count?: number;
  experience_years?: number;
  lesson_packages?: LessonPackage[];
};

type PriceOption = {
  key: string;
  label: string;
  note?: string;
  lessons: number;
  price: number;
};

const formatZar = (amt: number) =>
  new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR", maximumFractionDigits: 0 }).format(amt);

export default function PriceCalculator() {
  const [items, setItems] = useState<Instructor[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [selectedKey, setSelectedKey] = useState("single");

  useEffect(() => {
    fetch(`/api/backend/v1/instructors?city=Anywhere&limit=50`)
      .then(async r => {
        const data = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(data.error ?? "Could not load instructor prices");
        setItems(Array.isArray(data.items) ? data.items : []);
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const withRate = useMemo(
    () => items.filter(i => Number.isFinite(Number(i.hourly_rate)) && Number(i.hourly_rate) > 0),
    [items],
  );
  const visible = useMemo(() => withRate.slice(0, 6), [withRate]);
  const range = useMemo(() => {
    if (!withRate.length) return null;
    const rates = withRate.map(i => Number(i.hourly_rate));
    return { min: Math.min(...rates), max: Math.max(...rates) };
  }, [withRate]);

  const selected = useMemo(
    () => withRate.find(i => i.user_id === selectedId) ?? visible[0] ?? null,
    [withRate, visible, selectedId],
  );

  const options = useMemo<PriceOption[]>(() => {
    if (!selected) return [];
    const rate = Number(selected.hourly_rate) || 0;
    const packages = (selected.lesson_packages ?? [])
      .filter(p => Number(p?.lesson_count) > 0 && Number(p?.price) > 0)
      .map((p, index) => ({
        key: `pkg-${index}`,
        label: p.name?.trim() || `${p.lesson_count}-lesson package`,
        note: p.lesson_type,
        lessons: Number(p.lesson_count),
        price: Number(p.price),
      }));
    return [...packages, { key: "single", label: "Single lesson", note: "Pay as you go", lessons: 1, price: rate }];
  }, [selected]);

  const option = useMemo(
    () => options.find(o => o.key === selectedKey) ?? options[options.length - 1] ?? null,
    [options, selectedKey],
  );

  const calculation = useMemo(() => {
    if (!selected || !option) return null;
    const rate = Number(selected.hourly_rate) || 0;
    const listTotal = option.lessons * rate;
    const packageSaving = Math.max(0, listTotal - option.price);
    return {
      rate,
      listTotal,
      packageSaving,
      total: option.price,
      perLesson: Math.round(option.price / option.lessons),
    };
  }, [selected, option]);

  const firstName = selected?.full_name?.split(" ")[0] ?? "this instructor";
  const selectInstructor = (id: string) => {
    setSelectedId(id);
    setSelectedKey("single");
  };

  return (
    <div className="price-calc-container">
      <div className="price-calc-header">
        <div className="eyebrow"><Calculator size={13} style={{ display: "inline", verticalAlign: "middle", marginRight: 4 }} /> TRANSPARENT MZANSI PRICING</div>
        <h3>Instructors set their own prices</h3>
        <p>Every instructor chooses their own hourly rate and builds their own lesson packages. Pick an instructor, pick their package, and see exactly what you will pay before you book.</p>
        {range && (
          <div className="calc-rate-range">
            Verified instructor rates right now: <b>{formatZar(range.min)} – {formatZar(range.max)}</b> per hour, set by the instructors themselves.
          </div>
        )}
      </div>

      <div className="price-calc-grid">
        <div className="price-calc-controls">
          <label className="calc-group-label">1. CHOOSE YOUR INSTRUCTOR</label>
          {loading && <p className="calc-status">Loading instructor prices…</p>}
          {!loading && error && (
            <p className="calc-status" role="alert">
              {error} <a href="#explore">Browse instructors instead</a>
            </p>
          )}
          {!loading && !error && !visible.length && (
            <p className="calc-status">
              No instructor has published prices yet. <a href="#explore">Check back soon</a>
            </p>
          )}
          {!!visible.length && (
            <div className="calc-tier-cards">
              {visible.map(item => {
                const isSelected = selected?.user_id === item.user_id;
                return (
                  <div
                    key={item.user_id}
                    className={`calc-tier-card ${isSelected ? "selected" : ""}`}
                    onClick={() => selectInstructor(item.user_id)}
                    onKeyDown={e => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        selectInstructor(item.user_id);
                      }
                    }}
                    role="button"
                    tabIndex={0}
                  >
                    <div className="tier-top">
                      <b>{item.full_name}</b>
                      {isSelected && <span className="popular-badge"><Check size={11} /> SELECTED</span>}
                    </div>
                    <div className="tier-mid">
                      <span className="tier-lessons">{formatZar(Number(item.hourly_rate))}<i style={{ fontStyle: "normal", fontSize: 12, fontWeight: 600, color: "#788075" }}> / hr</i></span>
                    </div>
                    <small className="tier-tagline">
                      <MapPin size={11} style={{ display: "inline", verticalAlign: "middle", marginRight: 3 }} />
                      {item.suburbs_covered?.slice(0, 2).join(", ") || item.city || "South Africa"}
                      {" · "}
                      {(item.avg_rating ?? item.rating) ? (
                        <><Star size={11} fill="currentColor" style={{ display: "inline", verticalAlign: "middle" }} /> {(Number(item.avg_rating ?? item.rating)).toFixed(1)}</>
                      ) : `${item.experience_years ?? 0} yrs experience`}
                    </small>
                  </div>
                );
              })}
            </div>
          )}

          {selected && option && (
            <>
              <label className="calc-group-label" style={{ marginTop: 20 }}>2. CHOOSE {firstName.toUpperCase()}&rsquo;S PACKAGE</label>
              <div className="calc-tier-cards">
                {options.map(o => {
                  const isSelected = o.key === option.key;
                  const listTotal = o.lessons * Number(selected.hourly_rate || 0);
                  const saving = Math.max(0, listTotal - o.price);
                  return (
                    <div
                      key={o.key}
                      className={`calc-tier-card ${isSelected ? "selected" : ""}`}
                      onClick={() => setSelectedKey(o.key)}
                      onKeyDown={e => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setSelectedKey(o.key);
                        }
                      }}
                      role="button"
                      tabIndex={0}
                    >
                      <div className="tier-top">
                        <b>{o.label}</b>
                        {saving > 0 && <span className="tier-save-tag">SAVE {formatZar(saving)}</span>}
                      </div>
                      <div className="tier-mid">
                        <span className="tier-lessons">{formatZar(o.price)}</span>
                        <span className="tier-tagline">
                          {o.lessons === 1 ? "1 lesson" : `${o.lessons} lessons`}
                          {o.lessons > 1 ? ` · ${formatZar(Math.round(o.price / o.lessons))} each` : ""}
                        </span>
                      </div>
                      <small className="tier-tagline">{o.note ?? (saving > 0 ? `${firstName}'s bundle price` : "Their standard rate")}</small>
                    </div>
                  );
                })}
              </div>

              <label className="calc-group-label" style={{ marginTop: 20 }}>HOW PRICING WORKS</label>
              <div className="calc-options">
                <div className="calc-checkbox-label">
                  <Check size={16} style={{ marginTop: 3, color: "var(--green)", flexShrink: 0 }} />
                  <span>
                    <b>Instructors name their own rates</b>
                    <small>MzansiDrive does not set lesson prices, bundle discounts or package sizes — each instructor does.</small>
                  </span>
                </div>
                <div className="calc-checkbox-label">
                  <Check size={16} style={{ marginTop: 3, color: "var(--green)", flexShrink: 0 }} />
                  <span>
                    <b>The price you see is the price you pay</b>
                    <small>These are real published rates from instructor profiles, not estimates.</small>
                  </span>
                </div>
              </div>
            </>
          )}
        </div>

        <div className="price-calc-summary">
          <div className="summary-card">
            {calculation && option && selected ? (
              <>
                <div className="summary-title">
                  <span>PACKAGE PRICE</span>
                  <h4>{formatZar(calculation.total)}</h4>
                  <small>Set by {selected.full_name} · {selected.city || "South Africa"}</small>
                </div>

                <div className="summary-breakdown">
                  <div className="summary-row">
                    <span>
                      {option.lessons} × {formatZar(calculation.rate)}
                      {option.lessons === 1 ? " (1 hour)" : " per hour"}
                    </span>
                    <b>{formatZar(calculation.listTotal)}</b>
                  </div>

                  {calculation.packageSaving > 0 && (
                    <div className="summary-row discount">
                      <span>{option.label} — {firstName}&rsquo;s own bundle price</span>
                      <b>- {formatZar(calculation.packageSaving)}</b>
                    </div>
                  )}

                  <div className="summary-divider" />

                  <div className="summary-row total">
                    <span>Total amount</span>
                    <b>{formatZar(calculation.total)}</b>
                  </div>

                  {option.lessons > 1 && (
                    <div className="summary-row">
                      <span>Works out at</span>
                      <b>{formatZar(calculation.perLesson)} per lesson</b>
                    </div>
                  )}

                  {calculation.packageSaving > 0 && (
                    <div className="total-saved-pill">
                      <Check size={14} /> {firstName} priced this bundle {formatZar(calculation.packageSaving)} below their hourly rate.
                    </div>
                  )}
                </div>

                <div className="summary-trust">
                  <p><ShieldCheck size={14} /> Price set by the instructor — MzansiDrive does not set lesson prices</p>
                  <p><ShieldCheck size={14} /> Pay securely with Paystack (Card, Capitec Pay, Instant EFT)</p>
                  <p><Check size={14} /> Funds released to instructor only after both confirm lesson</p>
                </div>

                <a href={`/instructors/${encodeURIComponent(selected.user_id)}`} className="calc-cta-button">
                  See {firstName}&rsquo;s profile &amp; book <ArrowRight size={15} />
                </a>
              </>
            ) : (
              <>
                <div className="summary-title">
                  <span>INSTRUCTOR-SET PRICING</span>
                  <h4>{loading ? "…" : "—"}</h4>
                  <small>{loading ? "Loading published rates" : "No instructor prices to show yet"}</small>
                </div>
                <div className="summary-trust">
                  <p><Users size={14} /> Instructors publish their own hourly rates and packages</p>
                  <p><ShieldCheck size={14} /> Pay securely with Paystack (Card, Capitec Pay, Instant EFT)</p>
                </div>
                <a href="#explore" className="calc-cta-button">
                  Browse instructors <ArrowRight size={15} />
                </a>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
