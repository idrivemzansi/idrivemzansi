import RoleShell from "@/components/RoleShell";
import { requireRole } from "@/lib/session";
export default async function AdminDashboardLayout({ children }: { children: React.ReactNode }) {
  const session=await requireRole("admin");
  return <RoleShell role="admin" email={session.email}>{children}</RoleShell>;
}
