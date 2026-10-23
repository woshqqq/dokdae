import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { MockBanner } from "@/components/mock-banner";
import { UserMenu } from "@/components/user-menu";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "독대", template: "%s · 독대" },
  description: "같은 모임 사람과 1:1로 깊이 대화하는 시간",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#faf7f2",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ko" className="h-full antialiased">
      <body className="flex min-h-full flex-col">
        <MockBanner />
        <div className="sticky top-0 z-20 border-b border-line/70 bg-bg/90 backdrop-blur">
          <div className="mx-auto flex h-14 w-full max-w-lg items-center justify-between px-4">
            <Link href="/" className="text-lg font-extrabold tracking-tight">
              독대
            </Link>
            <Suspense fallback={null}>
              <UserMenu />
            </Suspense>
          </div>
        </div>
        <main className="mx-auto w-full max-w-lg flex-1 px-4 pb-16 pt-5">{children}</main>
      </body>
    </html>
  );
}
