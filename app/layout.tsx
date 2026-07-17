import type { Metadata } from "next";
import { JetBrains_Mono } from "next/font/google";

import { AuthClaimer } from "@/components/auth/auth-claimer";
import { TopChrome } from "@/components/top-chrome";
import { TooltipProvider } from "@/components/ui/tooltip";
import { THEME_STORAGE_KEY } from "@/lib/theme";
import "./globals.css";

// Runs before paint: apply the persisted palette by stamping
// data-theme on <html> so there's no flash of the default theme.
const NO_FLASH_THEME = `try{var t=localStorage.getItem('${THEME_STORAGE_KEY}');if(t&&t!=='classic')document.documentElement.setAttribute('data-theme',t);}catch(e){}`;

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Monster Smashy Smashy",
  description: "A small arena-combat D&D game",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${jetbrainsMono.variable} h-full antialiased`}
      // The no-flash script below stamps data-theme on <html> before
      // React hydrates, so the client <html> intentionally differs
      // from the server's. Scope the hydration-warning suppression to
      // this element's attributes (the next-themes pattern).
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: NO_FLASH_THEME }} />
      </head>
      <body className="min-h-full flex flex-col">
        <TooltipProvider>
          <AuthClaimer />
          <div className="fixed right-4 top-4 z-50 md:right-6 md:top-6">
            <TopChrome />
          </div>
          {children}
        </TooltipProvider>
      </body>
    </html>
  );
}
