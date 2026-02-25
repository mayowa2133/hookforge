import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { Space_Grotesk, IBM_Plex_Mono } from "next/font/google";
import "@/app/globals.css";
import { getCurrentUser } from "@/lib/auth";
import { projectsV2FeatureFlags } from "@/lib/editor-cutover";
import { LogoutButton } from "@/components/navigation/logout-button";

const headingFont = Space_Grotesk({ subsets: ["latin"], variable: "--font-heading" });
const monoFont = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-mono" });

export const metadata: Metadata = {
  title: "HookForge",
  description: "Template-driven short-form video creator"
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const user = await getCurrentUser();

  return (
    <html lang="en" className={`${headingFont.variable} ${monoFont.variable}`}>
      <body>
        <header className="sticky top-0 z-50 border-b border-black/10 bg-white/75 backdrop-blur">
          <div className="container flex h-16 items-center justify-between">
            <Link href="/" className="text-xl font-bold tracking-tight" style={{ fontFamily: "var(--font-heading)" }}>
              HookForge
            </Link>
            <nav className="flex items-center gap-3 text-sm">
              {projectsV2FeatureFlags.quickStartVisible ? (
                projectsV2FeatureFlags.showTemplatesNav ? (
                  <Link href="/templates" className="font-medium hover:text-primary">
                    Templates
                  </Link>
                ) : (
                  <Link href="/templates" className="font-medium hover:text-primary">
                    Quick Start
                  </Link>
                )
              ) : null}
              {user ? (
                <>
                  <Link href="/dashboard" className="font-medium hover:text-primary">
                    Dashboard
                  </Link>
                  <Link href="/creator" className="font-medium hover:text-primary">
                    Creator
                  </Link>
                  <Link href="/growth" className="font-medium hover:text-primary">
                    Growth
                  </Link>
                  <Link href="/localization" className="font-medium hover:text-primary">
                    Localization
                  </Link>
                  <Link href="/launch" className="font-medium hover:text-primary">
                    Launch
                  </Link>
                  <Link href="/mobile" className="font-medium hover:text-primary">
                    Mobile
                  </Link>
                  <Link href="/settings/security" className="font-medium hover:text-primary">
                    Security
                  </Link>
                  <LogoutButton />
                </>
              ) : (
                <>
                  <Link href="/login" className="font-medium hover:text-primary">
                    Login
                  </Link>
                  <Link href="/register" className="font-medium hover:text-primary">
                    Register
                  </Link>
                </>
              )}
            </nav>
          </div>
        </header>

        <main className="container py-8">{children}</main>
      </body>
    </html>
  );
}
