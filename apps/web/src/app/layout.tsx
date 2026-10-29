import type { Metadata } from "next";
import "./globals.css";
import "leaflet/dist/leaflet.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://www.mzansidrive.co.za"),
  title: "iDriveMzansi — Find your perfect driving instructor",
  description: "Book trusted, local driving instructors. Compare lessons, choose your time and get road-ready with iDriveMzansi.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en-ZA"><body>{children}</body></html>;
}
