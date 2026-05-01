import type { Metadata } from "next";
import { JetBrains_Mono } from "next/font/google";

import { AuthButton } from "@/components/auth/auth-button";
import { AuthClaimer } from "@/components/auth/auth-claimer";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

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
      <body className="min-h-full flex flex-col">
        <TooltipProvider>
          <AuthClaimer />
          <div className="fixed right-6 top-6 z-50">
            <AuthButton />
          </div>
          {children}
        </TooltipProvider>
      </body>
    </html>
  );
}
