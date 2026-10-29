import { requireRole } from "@/lib/session";
import InstructorAvailability from "@/components/InstructorAvailability";
export default async function InstructorAvailabilityPage(){await requireRole("instructor");return <><div className="dashboard-title"><div className="auth-eyebrow">INSTRUCTOR SPACE</div><h1>Manage availability</h1><p>Keep the calendar up to date so learners can book a time that works.</p></div><InstructorAvailability/></>;}

