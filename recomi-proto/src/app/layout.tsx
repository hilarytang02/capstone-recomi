import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Recomi Proto",
  description: "A clean, minimal Next.js 14 + TypeScript + Tailwind CSS project",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}
