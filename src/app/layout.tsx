import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "FrontDesk — Support, handled",
  description: "A helpful AI front desk trained on your business knowledge.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
