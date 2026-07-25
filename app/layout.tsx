import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Concord - Across Traditions",
  description:
    "Every statement is traceable to a source you can open and read yourself. When it does not know, it says so.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
