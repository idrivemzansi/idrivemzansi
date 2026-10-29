"use client";

import { useMemo, useState } from "react";
import { ArrowRight, Calculator, Check, Sparkles, Tag, ShieldCheck } from "lucide-react";

interface PackageTier {
  id: string;
  name: string;
  lessons: number;
  discountPct: number;
  popular?: boolean;
  tagline: string;
}

const tiers: PackageTier[] = [
  { id: "single", name: "Single Evaluation", lessons: 1, discountPct: 0, tagline: "Assess your baseline & test the waters" },
  { id: "starter", name: "Confidence Starter", lessons: 5, discountPct: 5, tagline: "Master basic manoeuvres & vehicle controls" },
  { id: "ready", name: "Road Ready Pack", lessons: 10, discountPct: 10, popular: true, tagline: "Full city driving, parking & intersection prep" },
  { id: "complete", name: "K53 Pass Guarantee", lessons: 20, discountPct: 15, tagline: "Zero to licenced driver with mock test exams" },
];

export default function PriceCalculator() {
  const [selectedTier, setSelectedTier] = useState<string>("ready");
  const [transmission, setTransmission] = useState<"manual" | "automatic">("manual");
  const [includeTestCar, setIncludeTestCar] = useState<boolean>(true);
  const [ownVehicle, setOwnVehicle] = useState<boolean>(false);
  const [applyReferral, setApplyReferral] = useState<boolean>(true);

  // South African standard base hourly rates
  const hourlyBase = transmission === "manual" ? 300 : 330;
  const testCarRentalRate = 750; // Dual control test-day car hire + 1hr warmup
  const referralCredit = 100;

  const currentTier = useMemo(() => tiers.find(t => t.id === selectedTier) ?? tiers[2], [selectedTier]);

  const calculation = useMemo(() => {
    const rawLessonTotal = currentTier.lessons * hourlyBase;
    const tierDiscount = (rawLessonTotal * currentTier.discountPct) / 100;
    const ownVehicleDiscount = ownVehicle ? (rawLessonTotal - tierDiscount) * 0.1 : 0;
    const testDayAddon = includeTestCar ? testCarRentalRate : 0;
    const subtotal = rawLessonTotal - tierDiscount - ownVehicleDiscount + testDayAddon;
    const referralDiscount = applyReferral ? Math.min(referralCredit, subtotal) : 0;
    const grandTotal = Math.max(0, subtotal - referralDiscount);
    const totalSavings = tierDiscount + ownVehicleDiscount + referralDiscount;

    return {
      rawLessonTotal,
      tierDiscount,
      ownVehicleDiscount,
      testDayAddon,
      referralDiscount,
      grandTotal,
      totalSavings,
      perLessonRate: Math.round((rawLessonTotal - tierDiscount - ownVehicleDiscount) / currentTier.lessons),
    };
  }, [currentTier, hourlyBase, ownVehicle, includeTestCar, applyReferral]);

  const formatZar = (amt: number) =>
    new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR", maximumFractionDigits: 0 }).format(amt);

  return (
    <div className="price-calc-container">
      <div className="price-calc-header">
        <div className="eyebrow"><Calculator size={13} style={{ display: "inline", verticalAlign: "middle", marginRight: 4 }} /> TRANSPARENT MZANSI PRICING</div>
        <h3>Calculate your lesson package</h3>
        <p>No surprises, no hidden vehicle fees. Choose your package and see your exact savings upfront.</p>
      </div>

      <div className="price-calc-grid">
        <div className="price-calc-controls">
          <label className="calc-group-label">1. CHOOSE YOUR TRANSMISSION</label>
          <div className="calc-pill-toggle">
            <button
              type="button"
              className={transmission === "manual" ? "active" : ""}
              onClick={() => setTransmission("manual")}
            >
              Manual (Code 8 / EB) · R300/hr
            </button>
            <button
              type="button"
              className={transmission === "automatic" ? "active" : ""}
              onClick={() => setTransmission("automatic")}
            >
              Automatic · R330/hr
            </button>
          </div>

          <label className="calc-group-label" style={{ marginTop: 20 }}>2. SELECT LESSON BUNDLE</label>
          <div className="calc-tier-cards">
            {tiers.map(tier => {
              const isSelected = tier.id === selectedTier;
              return (
                <div
                  key={tier.id}
                  className={`calc-tier-card ${isSelected ? "selected" : ""}`}
                  onClick={() => setSelectedTier(tier.id)}
                  role="button"
                  tabIndex={0}
                >
                  <div className="tier-top">
                    <b>{tier.name}</b>
                    {tier.popular && <span className="popular-badge"><Sparkles size={11} /> MOST POPULAR</span>}
                  </div>
                  <div className="tier-mid">
                    <span className="tier-lessons">{tier.lessons} {tier.lessons === 1 ? "Lesson" : "Lessons"}</span>
                    {tier.discountPct > 0 && <span className="tier-save-tag"><Tag size={11} /> Save {tier.discountPct}%</span>}
                  </div>
                  <small className="tier-tagline">{tier.tagline}</small>
                </div>
              );
            })}
          </div>

          <label className="calc-group-label" style={{ marginTop: 20 }}>3. OPTIONAL ADD-ONS</label>
          <div className="calc-options">
            <label className="calc-checkbox-label">
              <input
                type="checkbox"
                checked={includeTestCar}
                onChange={e => setIncludeTestCar(e.target.checked)}
              />
              <span>
                <b>Include Test-Day Car Hire (+R750)</b>
                <small>Dual-control vehicle provided at your DLTC test centre + 60 min pre-test warmup.</small>
              </span>
            </label>

            <label className="calc-checkbox-label">
              <input
                type="checkbox"
                checked={ownVehicle}
                onChange={e => setOwnVehicle(e.target.checked)}
              />
              <span>
                <b>Use Your Own Vehicle (10% extra discount)</b>
                <small>Valid for learners with valid permit and roadworthy, insured vehicle.</small>
              </span>
            </label>

            <label className="calc-checkbox-label">
              <input
                type="checkbox"
                checked={applyReferral}
                onChange={e => setApplyReferral(e.target.checked)}
              />
              <span>
                <b>Apply Referral / Welcome Credit (-R100)</b>
                <small>Automatically deducted from your first booking checkout.</small>
              </span>
            </label>
          </div>
        </div>

        <div className="price-calc-summary">
          <div className="summary-card">
            <div className="summary-title">
              <span>ESTIMATED INVESTMENT</span>
              <h4>{formatZar(calculation.grandTotal)}</h4>
              <small>All inclusive with VAT · No hidden booking charges</small>
            </div>

            <div className="summary-breakdown">
              <div className="summary-row">
                <span>{currentTier.lessons} × {currentTier.lessons === 1 ? "hour" : "hours"} ({transmission})</span>
                <b>{formatZar(calculation.rawLessonTotal)}</b>
              </div>

              {calculation.tierDiscount > 0 && (
                <div className="summary-row discount">
                  <span>Bundle savings ({currentTier.discountPct}%)</span>
                  <b>- {formatZar(calculation.tierDiscount)}</b>
                </div>
              )}

              {calculation.ownVehicleDiscount > 0 && (
                <div className="summary-row discount">
                  <span>Own vehicle discount (10%)</span>
                  <b>- {formatZar(calculation.ownVehicleDiscount)}</b>
                </div>
              )}

              {includeTestCar && (
                <div className="summary-row">
                  <span>DLTC Test-Day vehicle hire</span>
                  <b>+ {formatZar(testCarRentalRate)}</b>
                </div>
              )}

              {calculation.referralDiscount > 0 && (
                <div className="summary-row discount">
                  <span>Referral / Welcome credit</span>
                  <b>- {formatZar(calculation.referralDiscount)}</b>
                </div>
              )}

              <div className="summary-divider" />

              <div className="summary-row total">
                <span>Total amount</span>
                <b>{formatZar(calculation.grandTotal)}</b>
              </div>

              {calculation.totalSavings > 0 && (
                <div className="total-saved-pill">
                  <Check size={14} /> You save a total of {formatZar(calculation.totalSavings)} on this package!
                </div>
              )}
            </div>

            <div className="summary-trust">
              <p><ShieldCheck size={14} /> Pay securely with Paystack (Card, Capitec Pay, Instant EFT)</p>
              <p><Check size={14} /> Funds released to instructor only after both confirm lesson</p>
            </div>

            <a href="/learner/book" className="calc-cta-button">
              Book this package <ArrowRight size={15} />
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
