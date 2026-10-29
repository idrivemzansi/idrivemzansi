import { requireRole } from "@/lib/session";
import BookingCheckout from "@/components/BookingCheckout";
export default async function LearnerBookPage(){await requireRole("learner");return <><div className="dashboard-title"><div className="auth-eyebrow">BOOK A LESSON</div><h1>Choose a lesson time.</h1><p>Choose a verified instructor and a time suggested for you.</p></div><BookingCheckout/></>;}

