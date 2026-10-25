import { LegacyChrome } from "@/components/legacy-chrome";

export default function LegacyLayout({ children }: { children: React.ReactNode }) {
  return <LegacyChrome>{children}</LegacyChrome>;
}
