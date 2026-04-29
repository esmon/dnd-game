import type { Metadata } from "next";
import { JetBrains_Mono } from "next/font/google";

import { AuthButton } from "@/components/auth/auth-button";
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
          <div className="fixed right-2 top-2 z-50 md:right-4 md:top-4">
            <AuthButton />
          </div>
          {children}
        </TooltipProvider>
      </body>
    </html>
  );
}
