import { requireRole } from "@/lib/session";
import AdminPayments from "@/components/AdminPayments";
export default async function AdminPaymentsPage() {
  await requireRole("admin");
  return <AdminPayments />;
}
