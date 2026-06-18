import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "streamkit demo",
  description: "Live demo of streamkit — AI-streaming UI primitives for React",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
