import { requireRole } from "@/lib/session";
import InstructorWizard from "@/components/InstructorWizard";
export default async function InstructorOnboardingPage(){
  const session=await requireRole("instructor");
  return <><div className="dashboard-title"><div className="auth-eyebrow">YOUR TEACHING JOURNEY</div><h1>Build your instructor profile.</h1><p>One clear step at a time. You can save and come back whenever you like.</p></div><InstructorWizard email={session.email}/></>;
}
