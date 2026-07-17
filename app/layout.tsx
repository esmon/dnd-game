import type { Metadata } from "next";
import { JetBrains_Mono } from "next/font/google";

import { AuthButton } from "@/components/auth/auth-button";
import { AuthClaimer } from "@/components/auth/auth-claimer";
import { ThemeSwitcher } from "@/components/theme-switcher";
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
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: NO_FLASH_THEME }} />
      </head>
      <body className="min-h-full flex flex-col">
        <TooltipProvider>
          <AuthClaimer />
          <div className="fixed right-6 top-6 z-50 flex items-center gap-2">
            <ThemeSwitcher />
            <AuthButton />
          </div>
          {children}
        </TooltipProvider>
      </body>
    </html>
  );
}
