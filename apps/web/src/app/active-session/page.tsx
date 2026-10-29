import { redirect } from "next/navigation";
import { getProfileState, requireRole } from "@/lib/session";
import { ActiveSessionClient } from "@/components/ActiveSessionClient";

export default async function ActiveSessionPage({
  searchParams,
}: {
  searchParams: Promise<{ booking?: string }>;
}) {
  const session = await requireRole(["learner", "instructor"]);
  const profile = await getProfileState(session);
  if (!profile?.profileComplete) {
    redirect(session.role === "learner" ? "/complete-profile" : "/instructor/onboarding");
  }

  const { booking = "" } = await searchParams;
  return booking ? (
    <ActiveSessionClient bookingId={booking} />
  ) : (
    <main className="active-session">
      <h1>Active driving session</h1>
      <p>Open this page from a confirmed lesson using its booking link.</p>
    </main>
  );
}
