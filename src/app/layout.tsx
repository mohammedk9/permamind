import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import { TooltipProvider } from "@/components/ui/tooltip";
import { APP_DESCRIPTION, APP_NAME } from "@/lib/constants";
import { LocaleProvider } from "@/components/i18n/locale-provider";
import { ServiceWorkerRegistration } from "@/components/pwa/service-worker-registration";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL ?? "https://permamind.app";

/**
 * The chosen locale lives in localStorage, which the server cannot read. The
 * document therefore renders with English and corrects `lang`/`dir` on the
 * client in useLocale. A hardcoded `lang="ar"` here would fight that, so keep
 * the server default at English and let the client own the direction.
 */
const SSR_LOCALE = "en";

/**
 * Resolves the theme before the first paint.
 *
 * The `.dark` class is what the Tailwind `dark:` variant keys off, and the
 * `dark:` utilities are what most of this app's surfaces rely on. Applying that
 * class from React means it lands after hydration, so a user whose stored theme
 * is light first sees the black dark-mode palette and then a white flash when it
 * corrects itself. This runs synchronously in `<head>` instead: the document is
 * never painted with the wrong theme, and React then agrees with what is already
 * on the element rather than changing it.
 *
 * The logic is kept byte-identical to `resolveTheme` in `hooks/use-theme.ts` on
 * purpose. Two implementations would drift, and the drift would show up as a
 * flash on exactly the return visit that matters.
 */
const THEME_BOOTSTRAP = `(function(){try{var s=localStorage.getItem("permamind-theme");var d=s==="dark"||(s!=="light"&&window.matchMedia("(prefers-color-scheme: dark)").matches);var r=document.documentElement;r.classList.toggle("dark",d);r.style.colorScheme=d?"dark":"light";}catch(e){document.documentElement.classList.add("dark");}})();`;

export const metadata: Metadata = {
  metadataBase: new URL(APP_URL),
  title: {
    default: APP_NAME,
    template: `%s | ${APP_NAME}`,
  },
  description: APP_DESCRIPTION,
  applicationName: APP_NAME,
  manifest: "/manifest.json",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/favicon-16x16.png", sizes: "16x16", type: "image/png" },
      { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
      { url: "/permamind-favicon.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [
      { url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
    ],
  },
  openGraph: {
    title: APP_NAME,
    description: APP_DESCRIPTION,
    siteName: APP_NAME,
    type: "website",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 1200,
        alt: APP_NAME,
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: APP_NAME,
    description: APP_DESCRIPTION,
    images: ["/og-image.png"],
  },
  appleWebApp: {
    capable: true,
    title: APP_NAME,
    statusBarStyle: "default",
  },
};

export const viewport: Viewport = {
  // `cover` is what makes `env(safe-area-inset-*)` report real values on
  // notched phones. Several screens already pad with it (the chat composer and
  // the app sidebar), but without this the insets resolve to zero and the
  // bottom bar sits under the home indicator.
  width: "device-width",
  initialScale: 1,
  // 5x, not 1. Blocking zoom below that fails WCAG 1.4.4; the app still fits
  // because every scroll container uses `dvh` units rather than a fixed pixel
  // height.
  maximumScale: 5,
  viewportFit: "cover",
  /* Android Chrome resizes the *layout* viewport when the keyboard opens,
     which collapses a `100dvh` container and hides the submit button. This
     asks it to resize only the *visual* viewport instead, matching how iOS
     Safari already behaves. Unsupported engines ignore the token. */
  interactiveWidget: "resizes-content",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fafafa" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // No `className="dark"` on the html element on purpose. A hardcoded class would
  // paint the dark palette on every first visit before the bootstrap script below
  // corrected it, which is the flash that script exists to prevent.
  return (
    <html lang={SSR_LOCALE} dir="ltr" suppressHydrationWarning>
      <head>
        {/* Runs before the body paints. `dangerouslySetInnerHTML` is the only
            way to get a synchronous script here; the string is a build-time
            constant with no interpolated input. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <TooltipProvider>
          <ServiceWorkerRegistration />
          <LocaleProvider>{children}</LocaleProvider>
        </TooltipProvider>
      </body>
    </html>
  );
}
