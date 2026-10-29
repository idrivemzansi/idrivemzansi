import { redirect } from "next/navigation";
import RoleShell from "@/components/RoleShell";
import { getProfileState, requireRole } from "@/lib/session";
export default async function LearnerLayout({ children }: { children: React.ReactNode }) {
  const session=await requireRole("learner");
  const profile=await getProfileState(session);
  if (!profile?.profileComplete) redirect("/complete-profile");
  return <RoleShell role="learner" email={session.email}>{children}</RoleShell>;
}
