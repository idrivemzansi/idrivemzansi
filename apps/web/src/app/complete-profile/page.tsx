import { redirect } from "next/navigation";
import { requireRole,getProfileState } from "@/lib/session";
import LearnerProfileForm from "@/components/LearnerProfileForm";
export default async function CompleteProfilePage() {
  const session=await requireRole("learner");
  const profile=await getProfileState(session);
  if(profile?.profileComplete) redirect("/learner");
  return <main className="role-shell"><header className="role-header"><a className="auth-brand" href="/"><span>🚘</span><b>iDrive<span>Mzansi</span></b></a><span>LEARNER SETUP</span><div className="role-identity">{session.email}</div></header><div className="role-body" style={{gridTemplateColumns:"1fr",maxWidth:820}}><section className="role-content"><div className="dashboard-title"><div className="auth-eyebrow">STEP 1 OF YOUR JOURNEY</div><h1>Let’s get to know you.</h1><p>Complete your learner profile before booking lessons. Your documents stay private.</p></div><LearnerProfileForm/></section></div></main>;
}
