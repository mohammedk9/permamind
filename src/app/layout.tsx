import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import { QueueStatus } from "@/components/arweave/queue-status";
import { TooltipProvider } from "@/components/ui/tooltip";
import { APP_DESCRIPTION, APP_NAME } from "@/lib/constants";
import { LocaleProvider } from "@/components/i18n/locale-provider";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: APP_NAME,
  description: APP_DESCRIPTION,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <TooltipProvider>
          <LocaleProvider>{children}</LocaleProvider>
          <QueueStatus className="fixed bottom-4 right-4 z-50" />
        </TooltipProvider>
      </body>
    </html>
  );
}
