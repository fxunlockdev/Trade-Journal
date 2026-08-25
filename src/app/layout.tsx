import type { Metadata } from "next";
import { Hanken_Grotesk, Jost, Manrope, Space_Grotesk } from "next/font/google";
import { ThemeProvider } from "@/components/theme-provider";
import { ToasterProvider } from "@/components/toaster-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

// Manrope — body, data & UI labels (legible, balanced).
const manrope = Manrope({
  variable: "--font-sans",
  subsets: ["latin"],
  display: "swap",
});

// Hanken Grotesk — display & headings (sharp, technical, tightly tracked).
const hanken = Hanken_Grotesk({
  variable: "--font-hanken",
  subsets: ["latin"],
  weight: ["500", "600", "700", "800"],
  display: "swap",
});

// Space Grotesk + Jost — the poster templates only. Self-hosted by next/font so
// the PNG rasteriser can embed them same-origin; a CORS-blocked webfont would
// silently fall back to a system face and change every poster's look.
const spaceGrotesk = Space_Grotesk({
  variable: "--font-poster-display",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

const jost = Jost({
  variable: "--font-poster-body",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "FXU · One account for Trade Journal & Affiliate CRM",
  description:
    "FXU Home: one sign-in for the Trade Journal and the Affiliate CRM.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${manrope.variable} ${hanken.variable} ${spaceGrotesk.variable} ${jost.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full bg-background text-foreground">
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          {/* Global tooltip provider — snappy 200ms open (Base UI defaults to
              600ms with no provider, which reads as "no tooltip") and groups
              adjacent help icons so moving between them is instant. */}
          <TooltipProvider delay={200} closeDelay={0}>
            {children}
          </TooltipProvider>
          <ToasterProvider />
        </ThemeProvider>
      </body>
    </html>
  );
}
