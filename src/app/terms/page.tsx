import type { Metadata } from "next";
import { LegalPage } from "@/components/legal/legal-page";

export const metadata: Metadata = {
  title: "Terms of Use",
  description: "The terms for using PermaMind, including AI responses, your content, and permanent storage.",
};

export default function TermsPage() {
  return <LegalPage kind="terms" />;
}
