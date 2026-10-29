import { requireRole } from "@/lib/session";
const titles:Record<string,string>={learners:"Learners",instructors:"Instructors",bookings:"Bookings",disputes:"Disputes",settings:"Platform settings"};
export default async function AdminSection({params}:{params:Promise<{section:string}>}){
  await requireRole("admin");const {section}=await params;const title=titles[section]??"Admin operations";
  return <><div className="dashboard-title"><div className="auth-eyebrow">ADMIN OPERATIONS</div><h1>{title}</h1><p>Manage iDriveMzansi accounts, lessons and marketplace settings.</p></div><div className="status-card"><h2>{title} tools are ready to connect.</h2><p>This area is protected by the Cognito admin group. Connect the relevant operational workflow to manage records.</p></div></>;
}
