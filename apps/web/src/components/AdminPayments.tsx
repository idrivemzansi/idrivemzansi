"use client";
import { useEffect, useState } from "react";

type PaymentData = { transactions: any[]; paymentTransactions: any[]; payouts: any[]; currency: string };
const money = (value: number) => `R${Number(value ?? 0).toFixed(2)}`;
async function request(path: string, init?: RequestInit) {
  const response = await fetch(`/api/backend/v1/admin/payments${path}`, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error ?? "Payment request failed.");
  return result;
}
export default function AdminPayments() {
  const [data, setData] = useState<PaymentData | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [instructorId, setInstructorId] = useState("");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const refresh = async () => setData(await request(""));
  useEffect(() => { refresh().catch(e => setError(e.message)); }, []);
  async function manualPayout(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try { await request("/manual-payout", { method: "POST", body: JSON.stringify({ instructorId, amount: Number(amount), reason }) }); setInstructorId(""); setAmount(""); setReason(""); await refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : "Payout failed."); }
    finally { setBusy(false); }
  }
  async function retry(id: string) {
    setBusy(true); setError("");
    try { await request(`/payouts/${encodeURIComponent(id)}/process`, { method: "POST" }); await refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : "Payout failed."); }
    finally { setBusy(false); }
  }
  async function finalize(id: string) {
    const otp = window.prompt("Enter the Paystack transfer OTP:"); if (!otp) return;
    setBusy(true); setError("");
    try { await request(`/payouts/${encodeURIComponent(id)}/finalize`, { method: "POST", body: JSON.stringify({ otp }) }); await refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : "Transfer authorization failed."); }
    finally { setBusy(false); }
  }
  function exportCsv() {
    const rows = [["type","id","booking_id","learner_id","instructor_id","amount_charged","platform_fee","instructor_payout","payment_status","payout_status","created_at"], ...(data?.transactions ?? []).map(t => ["booking", t.id, t.id, t.learner_id, t.instructor_id, t.amount_charged, t.platform_fee, t.instructor_payout, t.payment_status, t.payout_status, t.created_at]), ...(data?.paymentTransactions ?? []).map(t => [t.kind, t.id, t.booking_id, t.user_id, t.instructor_id, t.amount, "", "", t.status, t.refund_status, t.created_at]), ...(data?.payouts ?? []).map(p => ["payout", p.id, p.booking_id, "", p.instructor_id, p.amount, "", p.amount, p.status, p.status, p.created_at])];
    const csv = rows.map(row => row.map(value => `"${String(value ?? "").replaceAll('"','""')}"`).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" })); const a = document.createElement("a"); a.href = url; a.download = `mzansidrive-payments-${new Date().toISOString().slice(0,10)}.csv`; a.click(); URL.revokeObjectURL(url);
  }
  return <div>
    <div className="dashboard-title"><div className="auth-eyebrow">ADMIN OPERATIONS</div><h1>Payments & payouts</h1><p>Review booking collections, platform fees, refunds, and instructor or company transfers.</p></div>
    {error && <div role="alert" className="status-card" style={{ color: "#9b382f" }}>{error}</div>}
    <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginBottom: 16 }}><button className="inline-link" onClick={() => refresh().catch(e => setError(e.message))}>Refresh</button><button className="inline-link" onClick={exportCsv} disabled={!data}>Export CSV</button></div>
    <div className="status-card"><div className="auth-eyebrow">MANUAL PAYOUT</div><h2>Send an instructor payout</h2><form onSubmit={manualPayout} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 10, marginTop: 14 }}><input required placeholder="Instructor user ID" value={instructorId} onChange={e => setInstructorId(e.target.value)} /><input required type="number" min="0.01" step="0.01" placeholder="Amount (ZAR)" value={amount} onChange={e => setAmount(e.target.value)} /><input required placeholder="Reason" value={reason} onChange={e => setReason(e.target.value)} /><button disabled={busy}>Create payout</button></form><p>Transfers are sent from the configured Paystack balance to the instructor's account or their company's account.</p></div>
    <div className="status-card" style={{ marginTop: 16, overflowX: "auto" }}><div className="auth-eyebrow">PAYMENT TRANSACTIONS · ZAR</div><h2>Bookings</h2><table style={{ width: "100%", textAlign: "left", borderCollapse: "collapse", fontSize: 12 }}><thead><tr>{["Booking", "Learner", "Instructor", "Charged", "Fee", "Payout", "Payment", "Payout status"].map(x => <th key={x} style={{ padding: 8 }}>{x}</th>)}</tr></thead><tbody>{data?.transactions.map(t => <tr key={t.id}>{[t.id, t.learner_id, t.instructor_id, money(t.amount_charged), money(t.platform_fee), money(t.instructor_payout), t.payment_status, t.payout_status ?? "—"].map((x, i) => <td key={i} style={{ padding: 8, borderTop: "1px solid #eceee8" }}>{x}</td>)}</tr>)}</tbody></table>{data?.transactions.length === 0 && <p>No transactions recorded yet.</p>}</div>
    <div className="status-card" style={{ marginTop: 16, overflowX: "auto" }}><div className="auth-eyebrow">PAYSTACK CHARGES</div><h2>Membership transactions</h2><table style={{ width: "100%", textAlign: "left", borderCollapse: "collapse", fontSize: 12 }}><thead><tr>{["Reference", "Instructor", "Type", "Tier", "Amount", "Status", "Refund", "Created"].map(x => <th key={x} style={{ padding: 8 }}>{x}</th>)}</tr></thead><tbody>{data?.paymentTransactions.filter(t => String(t.kind).startsWith("instructor_membership")).map(t => <tr key={t.id}>{[t.id, t.user_id, t.kind, t.tier ?? "—", money(t.amount), t.status, t.refund_status ?? "—", t.created_at].map((x, i) => <td key={i} style={{ padding: 8, borderTop: "1px solid #eceee8" }}>{x}</td>)}</tr>)}</tbody></table>{data?.paymentTransactions.filter(t => String(t.kind).startsWith("instructor_membership")).length === 0 && <p>No membership payments recorded yet.</p>}</div>
    <div className="status-card" style={{ marginTop: 16, overflowX: "auto" }}><div className="auth-eyebrow">PAYOUT QUEUE</div><h2>Instructor and company transfers</h2><table style={{ width: "100%", textAlign: "left", borderCollapse: "collapse", fontSize: 12 }}><thead><tr>{["Payout", "Payee", "Type", "Amount", "Status", "Action"].map(x => <th key={x} style={{ padding: 8 }}>{x}</th>)}</tr></thead><tbody>{data?.payouts.map(p => <tr key={p.id}>{[p.id, p.payee_id ?? p.instructor_id, p.payee_type ?? "instructor", money(p.amount), p.status].map((x, i) => <td key={i} style={{ padding: 8, borderTop: "1px solid #eceee8" }}>{x}</td>)}<td style={{ padding: 8, borderTop: "1px solid #eceee8" }}>{p.status === "failed" ? <button disabled={busy} onClick={() => retry(p.id)}>Retry</button> : p.status === "awaiting_otp" ? <button disabled={busy} onClick={() => finalize(p.id)}>Authorize transfer</button> : "—"}</td></tr>)}</tbody></table>{data?.payouts.length === 0 && <p>No payouts recorded yet.</p>}</div>
  </div>;
}
