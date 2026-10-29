import { requireRole } from "@/lib/session";
import InstructorMembership from "@/components/InstructorMembership";
export default async function InstructorMembershipPage(){await requireRole("instructor");return <InstructorMembership/>;}
