import RoleShell from "@/components/RoleShell";
import { getSession } from "@/lib/session";
import { redirect } from "next/navigation";

export default async function CompanyLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login");
  return <RoleShell role={session.role} email={session.email}>{children}</RoleShell>;
}
