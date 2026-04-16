import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { Toaster } from "sonner";
// Using Sonner directly (not the shadcn wrapper) to avoid next-themes dependency
import "./globals.css";

const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "FX Unlock Trade Journal",
  description:
    "Professional forex trading journal, analytics, and signal management platform.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.variable} h-full antialiased`}>
      <body className="min-h-full bg-background text-foreground">
        {children}
        <Toaster
          theme="light"
          position="top-right"
          richColors
          closeButton
        />
      </body>
    </html>
  );
}
