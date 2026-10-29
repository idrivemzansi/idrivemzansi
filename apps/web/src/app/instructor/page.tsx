import { redirect } from "next/navigation";
import { getProfileState,requireRole } from "@/lib/session";
import InstructorDashboard from "@/components/InstructorDashboard";
export default async function InstructorHome({searchParams}:{searchParams:Promise<{tab?:string}>}){
  const session=await requireRole("instructor");const state=await getProfileState(session);
  if(!state?.profileComplete)redirect("/instructor/onboarding");
  const params=await searchParams;const tabs:Record<string,string>={messages:"Messages",payouts:"Payouts"};
  return <InstructorDashboard initialTab={tabs[params.tab??""]??"Overview"}/>;
}
