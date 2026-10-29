import { requireRole } from "@/lib/session";
import LearnerDashboard from "@/components/LearnerDashboard";
export default async function LearnerHome({searchParams}:{searchParams:Promise<{tab?:string}>}){
  await requireRole("learner");
  const params=await searchParams;const tabs:Record<string,string>={bookings:"My Bookings",instructors:"My Instructors",progress:"Progress",k53:"K53 Test Simulator",logbook:"Digital Logbook",enatis:"eNaTIS Monitor",resources:"Learning Resources",referrals:"Learner Referrals",videos:"Video Lessons"};
  return <LearnerDashboard initialTab={tabs[params.tab??""]??"Overview"}/>;
}
