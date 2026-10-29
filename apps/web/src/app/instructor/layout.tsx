import RoleShell from "@/components/RoleShell";
import { requireRole } from "@/lib/session";
export default async function InstructorLayout({ children }: { children: React.ReactNode }) {
  const session=await requireRole("instructor");
  return <RoleShell role="instructor" email={session.email}>{children}</RoleShell>;
}
