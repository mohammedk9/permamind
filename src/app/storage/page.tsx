import type { Metadata } from "next";
import { StorageGuidePage } from "@/components/storage/storage-guide-page";

export const metadata: Metadata = {
  title: "Storage choices",
  description: "How local storage, Supabase cloud storage, and Arweave backups differ.",
};

export default function StoragePage() {
  return <StorageGuidePage />;
}
