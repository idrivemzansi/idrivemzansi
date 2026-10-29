"use client";
import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ArrowRight, CarFront, LoaderCircle, ShieldCheck } from "lucide-react";

type Role = "learner" | "instructor";
const messages: Record<string, string> = { "Email or password is incorrect.": "That email and password combination didn’t match.", "This account is not assigned to the admin role.": "This account doesn’t have admin access." };
function Brand() { return <Link href="/" className="auth-brand"><span><CarFront size={20}/></span><b>mzansi<span>drive</span></b></Link>; }

export function SignupForm() {
  const router = useRouter();
  const [role, setRole] = useState<Role>("learner");
  const [companyInvite, setCompanyInvite] = useState("");
  const [referralCode,setReferralCode]=useState("");
  const [termsAccepted,setTermsAccepted]=useState(false);
  const [email, setEmail] = useState(""); const [phone, setPhone] = useState(""); const [password, setPassword] = useState(""); const [code, setCode] = useState("");
  const [verifyMode, setVerifyMode] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  useEffect(() => { const query=new URLSearchParams(window.location.search);if(query.get("role")==="instructor"||query.has("company_invite"))setRole("instructor");setCompanyInvite(query.get("company_invite")??"");setReferralCode(query.get("ref")??query.get("referral_code")??""); }, []);

  async function safeJson(res: Response, fallback: string) {
    try { const text = await res.text(); return text ? JSON.parse(text) : {}; }
    catch { throw new Error(fallback); }
  }

  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      if (!verifyMode) {
        if(!termsAccepted)throw new Error("Accept the Terms of Use before creating your account.");
        const response = await fetch("/api/auth/signup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, phone, password, role,terms_accepted:true, ...(companyInvite?{company_invite:companyInvite}:{}),...(referralCode?{referral_code:referralCode}:{}) }) });
        const data = await safeJson(response, "We couldn't start your sign up."); if (!response.ok) throw new Error(data.error ?? "We couldn't start your sign up.");
        setVerifyMode(true); return;
      }
      const confirmation = await fetch("/api/auth/confirm", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, code, role }) });
      const confirmationData = await safeJson(confirmation, "That code could not be verified."); if (!confirmation.ok) throw new Error(confirmationData.error ?? "That code could not be verified.");
      const login = await fetch("/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) });
      const loginData = await safeJson(login, "Email verified. Please sign in to continue."); if (!login.ok) throw new Error(loginData.error ?? "Email verified. Please sign in to continue.");
      router.replace(role === "learner" ? "/complete-profile" : "/instructor/onboarding");
    } catch (e) { setError(e instanceof Error ? (messages[e.message] ?? e.message) : "Something went wrong. Try again."); }
    finally { setBusy(false); }
  }
  async function resend() {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/auth/resend", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email }) });
      const data = await safeJson(response, "Could not resend your code."); if (!response.ok) throw new Error(data.error ?? "Could not resend your code.");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not resend your code."); }
    finally { setBusy(false); }
  }

  return <section className="auth-card"><Brand/><div className="auth-eyebrow">{verifyMode ? "CHECK YOUR INBOX" : "YOUR NEXT CHAPTER"}</div><h1>{verifyMode ? "Verify your email." : "Your journey starts here."}</h1><p className="auth-intro">{verifyMode ? "We sent a one-time code to " + email + ". Enter it below to verify your account." : "Create your account and find the instructor who feels right for you."}</p>
    {!verifyMode && <>{companyInvite?<p className="auth-legal">You’re signing up as an instructor through a company invitation.</p>:<div className="auth-role-tabs"><button type="button" className={role==="learner"?"chosen":""} onClick={()=>setRole("learner")}>I’m a learner</button><button type="button" className={role==="instructor"?"chosen":""} onClick={()=>setRole("instructor")}>I’m an instructor</button></div>}</>}
    <form onSubmit={submit}>{!verifyMode ? <><label>Email address<input type="email" autoComplete="email" required value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@example.co.za"/></label><label>South African mobile number<input type="tel" autoComplete="tel" required value={phone} onChange={e=>setPhone(e.target.value)} placeholder="+27821234567 or 0821234567"/></label><label>Password<input type="password" autoComplete="new-password" required minLength={12} value={password} onChange={e=>setPassword(e.target.value)} placeholder="At least 12 characters"/></label><p className="password-note">Use 12+ characters with upper and lowercase letters, a number, and a symbol.</p><label className="terms-check"><input type="checkbox" checked={termsAccepted} onChange={e=>setTermsAccepted(e.target.checked)}/> I accept the <Link href="/terms" target="_blank">Terms of Use</Link></label></> : <><label>One-time verification code<input className="code-input" inputMode="numeric" autoComplete="one-time-code" required value={code} onChange={e=>setCode(e.target.value)} placeholder="Enter the code from your email"/></label><button className="resend-code" type="button" disabled={busy} onClick={resend}>Send a new code</button></>}{error&&<div className="form-error" role="alert">{error}</div>}<button className="auth-submit" disabled={busy}>{busy?<LoaderCircle className="spin" size={17}/>:<>{verifyMode?"Verify email and continue":"Create account"}<ArrowRight size={16}/></>}</button></form>
    {!verifyMode ? <p className="auth-legal"><ShieldCheck size={14}/> Email verification is required before you can access MzansiDrive.</p> : <button className="auth-back" onClick={()=>{setVerifyMode(false);setCode("");}}><ArrowLeft size={14}/> Back to your details</button>}
    <div className="auth-bottom">{verifyMode?"Already verified?":"Already on the road?"} <Link href="/login">Sign in</Link></div>
  </section>;
}

export function LoginForm({ admin=false }: { admin?: boolean }) {
  const router = useRouter();
  const [companyInvite,setCompanyInvite]=useState("");
  const [email,setEmail]=useState(""); const [password,setPassword]=useState(""); const [busy,setBusy]=useState(false); const [error,setError]=useState("");
  useEffect(()=>{setCompanyInvite(new URLSearchParams(window.location.search).get("company_invite")??"");},[]);
  async function safeJson(res: Response, fallback: string) {
    try { const text = await res.text(); return text ? JSON.parse(text) : {}; }
    catch { throw new Error(fallback); }
  }
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const response=await fetch(admin?"/api/auth/admin-login":"/api/auth/login",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({email,password})});
      const data=await safeJson(response,"Sign in failed."); if(!response.ok) throw new Error(data.error??"Sign in failed.");
      if(companyInvite&&!admin){if(data.user.role!=="instructor")throw new Error("Company invitations can only be accepted by instructor accounts.");const invite=await fetch("/api/backend/v1/company/accept-invite",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({token:companyInvite})});const inviteData=await safeJson(invite,"Could not accept this company invitation.");if(!invite.ok)throw new Error(inviteData.error??"Could not accept this company invitation.");router.replace("/company/dashboard");return;}
      router.replace(admin?"/admin/dashboard":data.user.role==="instructor"?"/instructor":"/learner");
    } catch(e) { setError(e instanceof Error?(messages[e.message]??e.message):"Something went wrong. Try again."); }
    finally { setBusy(false); }
  }
  return <section className="auth-card"><Brand/><div className="auth-eyebrow">{admin?"SECURE ADMIN ACCESS":"GOOD TO SEE YOU"}</div><h1>{admin?"Admin sign in.":"Welcome back."}</h1><p className="auth-intro">{admin?"Sign in with an account assigned to the MzansiDrive admin group.":companyInvite?"Sign in to accept your company instructor invitation.":"Pick up right where you left off."}</p>
    <form onSubmit={submit}><label>Email address<input type="email" autoComplete="username" required value={email} onChange={e=>setEmail(e.target.value)} placeholder={admin?"admin@mzansidrive.co.za":"you@example.co.za"}/></label><label>Password<input type="password" autoComplete="current-password" required value={password} onChange={e=>setPassword(e.target.value)} placeholder="Your password"/></label>{error&&<div className="form-error" role="alert">{error}</div>}<button className="auth-submit" disabled={busy}>{busy?<LoaderCircle className="spin" size={17}/>:<>Sign in securely<ArrowRight size={16}/></>}</button></form>
    {admin?<p className="auth-legal"><ShieldCheck size={14}/> Admin access is granted only through the Cognito admin group.</p>:<div className="auth-bottom">New to MzansiDrive? <Link href="/signup">Create an account</Link></div>}
  </section>;
}

export function AuthFrame({ children }: { children: React.ReactNode }) {
  return <main className="auth-page"><div className="auth-image"><div className="auth-photo"/><div className="auth-image-copy"><span>YOUR ROAD. YOUR RULES.</span><b>Confidence comes<br/>one lesson at a time.</b><small>Made for Mzansi. Made for you.</small></div></div><div className="auth-form-side">{children}<div className="auth-footer">© 2026 MzansiDrive · <Link href="/terms">Terms</Link> · <Link href="/privacy">Privacy</Link></div></div></main>;
}
