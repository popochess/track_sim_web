import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "N Gauge Track Lab",
  description: "Tomix N gauge track layout simulator prototype"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-Hant" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
