import { requireRole } from "@/lib/session";
const titles:Record<string,string>={lessons:"My lessons",messages:"Messages",progress:"Progress & logbook",k53:"K53 practice",settings:"Account settings"};
export default async function LearnerSection({params}:{params:Promise<{section:string}>}){
  await requireRole("learner");const {section}=await params;const title=titles[section]??"Learner space";
  return <><div className="dashboard-title"><div className="auth-eyebrow">LEARNER SPACE</div><h1>{title}</h1><p>Your MzansiDrive account is ready. This section will fill in as you make bookings and build your driving record.</p></div><div className="status-card"><h2>Nothing to show yet.</h2><p>Once you book your first lesson, your {title.toLowerCase()} will appear here.</p><a className="inline-link" href="/#explore">Find an instructor →</a></div></>;
}
