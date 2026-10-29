"use client";

import dynamic from "next/dynamic";

const ActiveSession = dynamic(() => import("@/components/ActiveSession"), { ssr: false });

export function ActiveSessionClient({ bookingId }: { bookingId: string }) {
  return <ActiveSession bookingId={bookingId} />;
}
