import { redirect } from "next/navigation";
import { getProfileState,requireRole } from "@/lib/session";
import InstructorProfileEditor from "@/components/InstructorProfileEditor";
const titles:Record<string,string>={lessons:"My lessons",availability:"Availability",messages:"Messages","lesson-plans":"Lesson plans",earnings:"Earnings & payouts",videos:"Video lessons",settings:"Profile settings",pending:"Verification status"};
export default async function InstructorSection({params}:{params:Promise<{section:string}>}){
  const session=await requireRole("instructor");const state=await getProfileState(session);if(!state?.profileComplete)redirect("/instructor/onboarding");
  const {section}=await params;const title=titles[section]??"Instructor studio";
  const response=await fetch((process.env.API_BASE_URL??"http://localhost:4000")+"/v1/instructors/me/profile",{headers:{authorization:"Bearer "+session.accessToken},cache:"no-store"}).catch(()=>null);
  const data=response?.ok?await response.json():null;const item=data?.item;const approved=item?.verification_status==="active";
  return <><div className="dashboard-title"><div className="auth-eyebrow">INSTRUCTOR STUDIO</div><h1>{title}</h1><p>Keep your lessons, profile and teaching business moving.</p></div>{!approved?<div className="status-card"><div className="auth-eyebrow">PROFILE UNDER REVIEW</div><h2>Your teaching profile is being verified.</h2><p>You’ll be able to accept learner bookings once your instructor account has been approved.</p><a className="inline-link" href="/instructor/onboarding">Review onboarding details →</a></div>:section==="settings"?<InstructorProfileEditor initial={item??{}}/>:<div className="status-card"><h2>Nothing here just yet.</h2><p>When you start receiving bookings, your {title.toLowerCase()} will appear here.</p></div>}</>;
}
