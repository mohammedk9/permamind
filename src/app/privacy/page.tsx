import type { Metadata } from "next";
import { LegalPage } from "@/components/legal/legal-page";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "How PermaMind stores conversations, encryption passphrases, and optional Arweave backups.",
};

export default function PrivacyPage() {
  return <LegalPage kind="privacy" />;
}
