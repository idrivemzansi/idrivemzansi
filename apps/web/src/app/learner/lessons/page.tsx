import { requireRole } from "@/lib/session";
import LearnerBookings from "@/components/LearnerBookings";
export default async function LearnerLessonsPage(){await requireRole("learner");return <LearnerBookings/>;}
