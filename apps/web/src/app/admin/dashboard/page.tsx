import { requireRole } from "@/lib/session";
import AdminDashboardPanel from "@/components/AdminDashboard";
export default async function AdminDashboard(){
  await requireRole("admin");
  return <AdminDashboardPanel/>;
}
