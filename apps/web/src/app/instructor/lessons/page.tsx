import { requireRole } from "@/lib/session";
import InstructorBookings from "@/components/InstructorBookings";
export default async function InstructorLessonsPage(){await requireRole("instructor");return <InstructorBookings/>;}
