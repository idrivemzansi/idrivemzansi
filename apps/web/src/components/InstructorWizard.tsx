"use client";
import { ChangeEvent, FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Check, LoaderCircle, Sparkles, Upload } from "lucide-react";
import { isValidSaPhone, SA_PHONE_MESSAGE, toSaPhone } from "@/lib/sa-phone";

const lessonOptions = ["A1", "A", "B", "EB", "C1", "C", "EC1", "EC", "K53 Test Prep", "Defensive Driving", "Traffic Department Pass Out Test (3h)"];
const lessonDescriptions: Record<string, string> = { A1: "Motorcycle ≤125cc", A: "Motorcycle", B: "Motor vehicle", EB: "Motor vehicle articulated", C1: "Heavy motor vehicle", C: "Extra heavy", EC1: "Combination", EC: "Extra heavy combination", "K53 Test Prep": "K53 test preparation", "Defensive Driving": "Defensive driving", "Traffic Department Pass Out Test (3h)": "Traffic Department pass out test · 3 hours" };
const documents = [
  { key: "instructor_certificate", label: "Instructor Certificate", category: "instructor-certificate" },
  { key: "driver_licence", label: "Driver’s Licence", category: "driver-licence" },
  { key: "vehicle_roadworthy", label: "Vehicle Roadworthy", category: "vehicle-roadworthy" },
  { key: "sa_id", label: "SA ID", category: "sa-id" },
  { key: "police_clearance", label: "Police Clearance", category: "police-clearance" },
  { key: "vehicle_insurance", label: "Vehicle Insurance", category: "vehicle-insurance" },
  { key: "professional_liability_insurance", label: "Professional Liability Insurance", category: "professional-liability-insurance" },
] as const;
type DocKey = typeof documents[number]["key"];
type Check = { authenticity_score: number; quality_score: number; extracted_data: Record<string, unknown>; name_match: boolean; red_flags: string[]; recommendation: "approve" | "manual_review" | "reject" };
type Welcome = { subject: string; body: string; quick_tips: string[]; insights: string[] };
type Form = Record<string, string | string[]> & { full_name: string; phone: string; experience_years: string; languages: string; bio: string; primary_approach: string; secondary_approaches: string; philosophy: string; student_types: string; unique_techniques: string; city: string; suburbs_covered: string; vehicle_make: string; vehicle_model: string; transmission: string; hourly_rate: string };
const empty: Form = { full_name: "", phone: "", experience_years: "", languages: "", bio: "", primary_approach: "", secondary_approaches: "", philosophy: "", student_types: "", unique_techniques: "", city: "", suburbs_covered: "", vehicle_make: "", vehicle_model: "", transmission: "", hourly_rate: "" };
const stepNames = ["Basic info", "Teaching style", "Service area", "Vehicle & lessons", "Pricing", "Documents", "K53 assessment", "Review & submit", "Welcome"];
const split = (value: string) => value.split(",").map(v => v.trim()).filter(Boolean);
const docType: Record<DocKey, string> = { instructor_certificate: "instructor_certificate", driver_licence: "instructor_licence", vehicle_roadworthy: "vehicle_roadworthy", sa_id: "identity", police_clearance: "police_clearance", vehicle_insurance: "vehicle_insurance", professional_liability_insurance: "professional_liability_insurance" };
const asDocMap = (value: unknown): Partial<Record<DocKey, string>> => value && typeof value === "object" ? value as Partial<Record<DocKey, string>> : {};
const asCheckMap = (value: unknown): Partial<Record<DocKey, Check>> => value && typeof value === "object" ? value as Partial<Record<DocKey, Check>> : {};
function toNum(value: string) { const n = Number(value); return Number.isFinite(n) ? n : undefined; }
function toProfile(form: Form) {
  return { full_name: form.full_name, phone: toSaPhone(form.phone), experience_years: toNum(form.experience_years), languages: split(form.languages), bio: form.bio, primary_approach: form.primary_approach, secondary_approaches: split(form.secondary_approaches), philosophy: form.philosophy, student_types: split(form.student_types), unique_techniques: split(form.unique_techniques), city: form.city, suburbs_covered: split(form.suburbs_covered), vehicle_make: form.vehicle_make, vehicle_model: form.vehicle_model, transmission: form.transmission, lesson_types: Array.isArray(form.lesson_types) ? form.lesson_types : [], hourly_rate: toNum(form.hourly_rate), teaching_style: { primary_approach: form.primary_approach, philosophy: form.philosophy } };
}
function docCoverage(check?: Check) {
  const data = check?.extracted_data ?? {};
  const raw = data.coverage_amount ?? data.coverage_limit_zar ?? 0;
  return typeof raw === "number" ? raw : Number(String(raw).replace(/[^\d.]/g, ""));
}

export default function InstructorWizard({ email }: { email?: string }) {
  const router = useRouter();
  const [form, setForm] = useState<Form>(empty);
  const [step, setStep] = useState(1);
  const [busy, setBusy] = useState(false);
  const [busyLabel, setBusyLabel] = useState("");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [selectedLessons, setSelectedLessons] = useState<string[]>([]);
  const [docKeys, setDocKeys] = useState<Partial<Record<DocKey, string>>>({});
  const [checks, setChecks] = useState<Partial<Record<DocKey, Check>>>({});
  const [assessmentId, setAssessmentId] = useState("");
  const [questions, setQuestions] = useState<{ question: string; options: string[]; category: string }[]>([]);
  const [answers, setAnswers] = useState<number[]>([]);
  const [quizResult, setQuizResult] = useState<{ score: number; passed: boolean } | null>(null);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [welcome, setWelcome] = useState<Welcome | null>(null);
  const [pricing, setPricing] = useState<{ conservative: number; recommended: number; premium: number; reasoning: string } | null>(null);
  const [competitorRates, setCompetitorRates] = useState("");

  const update = (key: keyof Form, value: string | string[]) => setForm(old => ({ ...old, [key]: value }));
  useEffect(() => {
    fetch("/api/backend/v1/instructors/me/profile").then(r => r.json()).then(d => {
      const x = d.item;
      if (!x) { setForm(old => ({ ...old, email: email ?? "" })); return; }
      setForm(old => ({ ...old, ...x, email: email ?? x.email ?? "", experience_years: x.experience_years == null ? "" : String(x.experience_years), hourly_rate: x.hourly_rate == null ? "" : String(x.hourly_rate), languages: (x.languages ?? []).join(", "), secondary_approaches: (x.secondary_approaches ?? []).join(", "), student_types: (x.student_types ?? []).join(", "), unique_techniques: (x.unique_techniques ?? []).join(", "), suburbs_covered: (x.suburbs_covered ?? []).join(", "), lesson_types: x.lesson_types ?? [] }));
      setSelectedLessons(x.lesson_types ?? []); setDocKeys(asDocMap(x.documents)); setChecks(asCheckMap(x.document_verification));
      if (x.k53_assessment_passed) setQuizResult({ passed: true, score: Number(x.k53_assessment_score ?? 100) });
      if (x.welcome_message) setWelcome(x.welcome_message);
      if (x.terms_accepted_at) setTermsAccepted(true);
      setStep(Math.max(1, Math.min(9, Number(x.onboarding_step) || 1)));
    }).catch(() => setForm(old => ({ ...old, email: email ?? "" })));
  }, [email]);

  const coverage = docCoverage(checks.professional_liability_insurance);
  const completeSections = [
    Boolean(form.full_name.trim() && form.phone.trim() && form.experience_years !== "" && split(form.languages).length && form.bio.trim()),
    Boolean(form.primary_approach && split(form.secondary_approaches).length && form.philosophy && split(form.student_types).length && split(form.unique_techniques).length),
    Boolean(form.city && split(form.suburbs_covered).length >= 3),
    Boolean(form.vehicle_make && form.vehicle_model && form.transmission && selectedLessons.length),
    Boolean(form.hourly_rate && Number(form.hourly_rate) > 0),
    documents.every(d => Boolean(docKeys[d.key] && checks[d.key] && checks[d.key]?.recommendation !== "reject")) && coverage >= 1_000_000,
    Boolean(quizResult?.passed),
    termsAccepted,
  ];
  const completeness = Math.round(completeSections.filter(Boolean).length / 8 * 100);

  async function safeJson(res: Response, fallback: string) {
    try { const text = await res.text(); return text ? JSON.parse(text) : {}; }
    catch { throw new Error(fallback); }
  }
  async function save(complete = false) {
    setBusy(true); setError(""); setSaved(false);
    try {
      const r = await fetch("/api/backend/v1/instructors/me/onboarding", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ step, complete, terms_accepted: termsAccepted, profile: toProfile(form) }) });
      const d = await safeJson(r, "Could not save onboarding."); if (!r.ok) throw new Error(d.error ?? (d.missing?.join(", ") || "Could not save onboarding."));
      setSaved(true);
      if (complete) { setWelcome(d.welcome); setStep(9); }
      else setStep(Math.min(8, step + 1));
    } catch (e) { setError(e instanceof Error ? e.message : "Something went wrong. Try again."); }
    finally { setBusy(false); }
  }
  function validateStep() {
    if (step === 1 && !(form.full_name.trim() && form.phone.trim() && Number(form.experience_years) >= 0 && split(form.languages).length && form.bio.trim())) return "Complete your name, phone, experience, languages and bio.";
    if (step === 1 && !isValidSaPhone(form.phone)) return SA_PHONE_MESSAGE;
    if (step === 2 && !(form.primary_approach && split(form.secondary_approaches).length && form.philosophy && split(form.student_types).length && split(form.unique_techniques).length)) return "Complete each teaching style field.";
    if (step === 3 && !(form.city.trim() && split(form.suburbs_covered).length >= 3)) return "Add your city and at least three suburbs.";
    if (step === 4 && !(form.vehicle_make.trim() && form.vehicle_model.trim() && form.transmission && selectedLessons.length)) return "Add vehicle details, transmission and at least one lesson type.";
    if (step === 5 && !(Number(form.hourly_rate) > 0)) return "Enter your hourly rate.";
    if (step === 6 && !completeSections[5]) return coverage < 1_000_000 && checks.professional_liability_insurance ? "Professional liability insurance must show cover of at least R1,000,000." : "Upload and verify all seven documents before continuing.";
    if (step === 7 && !quizResult?.passed) return "Pass the 10-question K53 assessment with at least 80%.";
    if (step === 8 && !termsAccepted) return "Accept the Terms of Use before submitting.";
    return "";
  }
  async function continueStep() {
    const issue = validateStep(); if (issue) { setError(issue); return; }
    if (step === 8) { await save(true); return; }
    if (step < 8) await save(false);
  }
  async function generateBio() {
    setBusy(true); setBusyLabel("Writing your bio…"); setError("");
    try { const r = await fetch("/api/backend/ai/bio", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ instructor_profile: { ...toProfile(form), email } }) }); const d = await r.json(); if (!r.ok) throw new Error(d.error ?? "Could not generate a bio."); update("bio", d.bio); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not generate a bio."); }
    finally { setBusy(false); setBusyLabel(""); }
  }
  async function suggestPrice() {
    if (!form.city || !selectedLessons.length) { setError("Add a city and lesson types first to get a pricing suggestion."); return; }
    setBusy(true); setBusyLabel("Checking local pricing…"); setError("");
    try { const rates = split(competitorRates).map(Number).filter(Number.isFinite); const r = await fetch("/api/backend/ai/pricing-suggestion", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ city: form.city, lesson_types: selectedLessons, experience: Number(form.experience_years || 0), competitor_rates: rates }) }); const d = await r.json(); if (!r.ok) throw new Error(d.error ?? "Could not suggest a price."); setPricing(d); update("hourly_rate", String(d.recommended)); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not suggest a price."); }
    finally { setBusy(false); setBusyLabel(""); }
  }
  async function uploadAndVerify(key: DocKey, category: string, file?: File) {
    if (!file) return; setBusy(true); setBusyLabel("Uploading and verifying…"); setError("");
    try {
      const presign = await fetch("/api/backend/v1/uploads/presign", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ category, fileName: file.name, contentType: file.type }) }); const p = await presign.json(); if (!presign.ok) throw new Error(p.error ?? "Could not prepare document upload.");
      const put = await fetch(p.uploadUrl, { method: "PUT", headers: { "content-type": file.type }, body: file }); if (!put.ok) throw new Error("Could not upload document to secure storage.");
      const type = key === "driver_licence" ? "instructor_licence" : key === "vehicle_roadworthy" ? "vehicle_roadworthy" : key === "sa_id" ? "identity" : key;
      const result = await fetch("/api/backend/ai/document-verify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ document_type: type, s3_url: p.objectKey }) }); const v = await result.json(); if (!result.ok) throw new Error(v.error ?? "Document verification failed.");
      setDocKeys(old => ({ ...old, [key]: p.objectKey })); setChecks(old => ({ ...old, [key]: v })); setSaved(false);
      if (v.recommendation === "reject") setError(`We could not verify this ${documents.find(d => d.key === key)?.label}. Please upload a clearer document.`);
    } catch (e) { setError(e instanceof Error ? e.message : "Document upload failed."); }
    finally { setBusy(false); setBusyLabel(""); }
  }
  async function startQuiz() {
    setBusy(true); setBusyLabel("Preparing K53 questions…"); setError("");
    try { const r = await fetch("/api/backend/v1/instructors/me/k53-assessment/start", { method: "POST" }); const d = await r.json(); if (!r.ok) throw new Error(d.error ?? "Could not start assessment."); setAssessmentId(d.assessment_id); setQuestions(d.questions); setAnswers(Array(d.questions.length).fill(-1)); setQuizResult(null); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not start assessment."); }
    finally { setBusy(false); setBusyLabel(""); }
  }
  async function submitQuiz() {
    if (!assessmentId || answers.some(a => a < 0)) { setError("Answer all ten questions first."); return; }
    setBusy(true); setError("");
    try { const r = await fetch(`/api/backend/v1/instructors/me/k53-assessment/${assessmentId}/submit`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ answers }) }); const d = await r.json(); if (!r.ok) throw new Error(d.error ?? "Could not submit assessment."); setQuizResult({ score: d.score, passed: d.passed }); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not submit assessment."); }
    finally { setBusy(false); }
  }
  const textInput = (key: keyof Form, label: string, placeholder = "", wide = false, type = "text") => <label className={wide ? "wide" : ""}>{label}<input type={type} value={String(form[key] ?? "")} onChange={e => update(key, e.target.value)} placeholder={placeholder} /></label>;
  function handleFile(key: DocKey, category: string) { return (event: ChangeEvent<HTMLInputElement>) => { void uploadAndVerify(key, category, event.target.files?.[0]); event.target.value = ""; }; }
  function finish(e: FormEvent) { e.preventDefault(); void continueStep(); }

  if (step === 9) return <div className="profile-form"><div className="wizard-step-label"><span>STEP 9 OF 9 · WELCOME</span><span><Check size={14} /></span></div><div className="verification-banner"><h2>{welcome?.subject ?? `Welcome to MzansiDrive, ${form.full_name || "Instructor"}!`}</h2><p>{welcome?.body ?? "Your instructor profile is submitted for review. We’ve sent your welcome email."}</p>{welcome?.quick_tips?.map((tip, i) => <p key={i}>• {tip}</p>)}{welcome?.insights?.map((tip, i) => <p key={i}>• {tip}</p>)}</div><button className="wizard-next" type="button" onClick={() => router.replace("/instructor")}>Go to instructor dashboard <ArrowRight size={14} /></button></div>;

  return <form className="profile-form" onSubmit={finish}>
    <div className="wizard-step-label"><span>STEP {step} OF 9 · {stepNames[step - 1].toUpperCase()}</span><span>{completeness}% COMPLETE</span></div><div className="wizard-progress">{stepNames.map((_, i) => <span key={i} className={i < step ? "done" : ""} />)}</div>
    {step === 1 && <><h2>Tell learners who you are.</h2><p>Build trust with a clear introduction and the languages you teach in.</p><div className="wizard-fields">{textInput("full_name", "Full name", "As it appears on your ID")}{textInput("phone", "Phone number", "+27821234567 or 0821234567", false, "tel")}{textInput("experience_years", "Years of experience", "e.g. 6", false, "number")}{textInput("languages", "Languages you teach in", "English, isiZulu, Afrikaans", true)}<label className="wide">Instructor bio<textarea value={form.bio} onChange={e => update("bio", e.target.value)} placeholder="Your experience and what learners can expect…" /><button className="ai-inline" type="button" disabled={busy} onClick={() => void generateBio()}><Sparkles size={14} /> Generate with AI</button></label></div></>}
    {step === 2 && <><h2>How do you help learners thrive?</h2><p>Share your teaching approach, philosophy, and the learners you enjoy supporting.</p><div className="wizard-fields">{textInput("primary_approach", "Primary approach", "Patient and structured")}{textInput("secondary_approaches", "Other approaches", "Practical, confidence-building", true)}<label className="wide">Teaching philosophy<textarea value={form.philosophy} onChange={e => update("philosophy", e.target.value)} placeholder="What do you believe makes a safe, confident driver?" /></label>{textInput("student_types", "Student types", "Nervous beginners, career drivers", true)}{textInput("unique_techniques", "Unique techniques", "Visual route walkthroughs, calm repetition", true)}</div></>}
    {step === 3 && <><h2>Where do you teach?</h2><p>List at least three suburbs so learners can find you nearby.</p><div className="wizard-fields">{textInput("city", "City", "Johannesburg")}{textInput("suburbs_covered", "Suburbs (minimum 3)", "Rosebank, Sandton, Randburg", true)}</div></>}
    {step === 4 && <><h2>Vehicle and lesson types</h2><p>Choose every licence class and service you teach.</p><div className="wizard-fields">{textInput("vehicle_make", "Vehicle make", "Toyota")}{textInput("vehicle_model", "Vehicle model", "Starlet")}<label>Transmission<select value={form.transmission} onChange={e => update("transmission", e.target.value)}><option value="">Choose transmission</option><option value="manual">Manual</option><option value="automatic">Automatic</option><option value="both">Both</option></select></label><div className="wide"><b className="field-title">Lesson types</b><div className="lesson-options">{lessonOptions.map(option => <label key={option}><input type="checkbox" checked={selectedLessons.includes(option)} onChange={e => { const next = e.target.checked ? [...selectedLessons, option] : selectedLessons.filter(x => x !== option); setSelectedLessons(next); update("lesson_types", next); }} /><span><b>{option}</b><small>{lessonDescriptions[option]}</small></span></label>)}</div></div></div></>}
    {step === 5 && <><h2>Set your hourly rate.</h2><p>Rates are shown in South African Rand.</p><div className="wizard-fields">{textInput("hourly_rate", "Hourly rate (ZAR)", "e.g. 350", false, "number")}<label className="wide">Competitor rates in your area (optional)<input value={competitorRates} onChange={e => setCompetitorRates(e.target.value)} placeholder="300, 350, 400" /></label></div><button className="ai-inline" type="button" disabled={busy} onClick={() => void suggestPrice()}><Sparkles size={14} /> Suggest pricing with AI</button>{pricing && <div className="verification-banner">Conservative R{pricing.conservative} · Recommended R{pricing.recommended} · Premium R{pricing.premium}<p>{pricing.reasoning}</p></div>}</>}
    {step === 6 && <><h2>Upload your documents.</h2><p>Files are stored privately. Each upload is checked by AI immediately. Professional liability cover must be at least R1,000,000.</p><div className="document-list">{documents.map(doc => { const check = checks[doc.key]; return <div className="document-row" key={doc.key}><div><b>{doc.label}</b><small>{docKeys[doc.key] ? `${check?.recommendation === "reject" ? "Needs replacement" : check ? `AI check: ${check.recommendation.replace("_", " ")} · quality ${check.quality_score}%` : "Uploaded"}` : "PDF, JPEG, PNG or WebP · max 12 MB"}</small>{doc.key === "professional_liability_insurance" && check && <small>Detected cover: R{Number.isFinite(coverage) ? coverage.toLocaleString("en-ZA") : "not detected"}</small>}</div><label className="upload-button"><Upload size={14} />{busy ? busyLabel || "Working…" : docKeys[doc.key] ? "Replace" : "Upload"}<input type="file" accept="application/pdf,image/jpeg,image/png,image/webp" disabled={busy} onChange={handleFile(doc.key, doc.category)} /></label></div>; })}</div></>}
    {step === 7 && <><h2>Show your K53 knowledge.</h2><p>Answer ten multiple-choice questions. A score of 80% is required to continue.</p>{!questions.length ? <button type="button" className="ai-inline" disabled={busy} onClick={() => void startQuiz()}><Sparkles size={14} /> Start 10-question assessment</button> : <><div className="quiz-list">{questions.map((q, i) => <fieldset key={i}><legend>{i + 1}. {q.question}</legend><small>{q.category}</small>{q.options.map((option, j) => <label key={j}><input type="radio" name={`q-${i}`} checked={answers[i] === j} onChange={() => setAnswers(old => old.map((a, index) => index === i ? j : a))} /> {option}</label>)}</fieldset>)}</div><button type="button" className="ai-inline" disabled={busy || answers.some(a => a < 0)} onClick={() => void submitQuiz()}>Submit assessment</button></>}{quizResult && <div className={quizResult.passed ? "profile-success" : "form-error"}>{quizResult.passed ? `Passed — ${quizResult.score}%` : <>Score {quizResult.score}%. You need 80% to pass. <button type="button" className="retry-quiz" onClick={() => { setQuestions([]); setAssessmentId(""); setQuizResult(null); }}>Try another assessment</button></>}</div>}</>}
    {step === 8 && <><h2>Review and submit your profile.</h2><p>We’ll review your documents and activate your profile after approval.</p><div className="verification-banner"><b>{form.full_name}</b><br />{form.city} · {split(form.suburbs_covered).join(", ")}<br />{form.vehicle_make} {form.vehicle_model} · {selectedLessons.join(", ")}<br />R{form.hourly_rate} / hour · Commission defaults to 15%.<br /><b>Profile completeness: {completeness}%</b></div><label className="terms-check"><input type="checkbox" checked={termsAccepted} onChange={e => setTermsAccepted(e.target.checked)} /> I accept the <a href="/terms" target="_blank" rel="noreferrer">MzansiDrive Terms of Use</a>.</label><p className="small-note">Submitting will send your personalised welcome email via AWS SES.</p></>}
    {error && <div className="form-error" role="alert">{error}</div>}{saved && <div className="profile-success">Progress saved securely.</div>}
    <div className="wizard-actions">{step > 1 ? <button type="button" className="secondary" disabled={busy} onClick={() => setStep(step - 1)}><ArrowLeft size={14} /> Back</button> : <span />}{step < 9 && <button className={step === 8 ? "complete" : ""} disabled={busy} type="submit">{busy ? <LoaderCircle className="spin" size={14} /> : <>{step === 8 ? "Submit for review" : "Save & continue"} {step === 8 ? <Check size={14} /> : <ArrowRight size={14} />}</>}</button>}</div>
  </form>;
}
