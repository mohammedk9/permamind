export const RECOVERY_BUNDLE_KIND = "permamind-recovery";
export const RECOVERY_BUNDLE_VERSION = 1;

export interface RecoveryBundle {
  kind: typeof RECOVERY_BUNDLE_KIND;
  version: typeof RECOVERY_BUNDLE_VERSION;
  txId: string;
  snapshotVersion: number;
  createdAt: string;
  /** Present only inside the downloaded file. Never persisted by the app. */
  passphrase: string;
  steps: { ar: string[]; en: string[] };
}

export function buildRecoveryBundle(input: { txId: string; snapshotVersion: number; createdAt: string; passphrase: string }): RecoveryBundle {
  return {
    kind: RECOVERY_BUNDLE_KIND,
    version: RECOVERY_BUNDLE_VERSION,
    txId: input.txId,
    snapshotVersion: input.snapshotVersion,
    createdAt: input.createdAt,
    passphrase: input.passphrase,
    steps: {
      ar: ["افتح PermaMind ثم النسخ الاحتياطي.", "استورد ملف الاستعادة أو أدخل معرف المعاملة يدويًا.", "راجع المعاينة ثم اختر الدمج أو الاستبدال."],
      en: ["Open PermaMind and go to Backup.", "Import this recovery file, or enter the transaction ID manually.", "Review the preview, then choose merge or replace."],
    },
  };
}

export function parseRecoveryBundle(value: unknown): RecoveryBundle {
  const bundle = value as Partial<RecoveryBundle>;
  if (bundle?.kind !== RECOVERY_BUNDLE_KIND || bundle.version !== RECOVERY_BUNDLE_VERSION) throw new Error("This is not a PermaMind recovery file");
  if (!/^[A-Za-z0-9_-]{43}$/.test(bundle.txId ?? "") || typeof bundle.passphrase !== "string" || bundle.passphrase.length < 8) {
    throw new Error("Recovery file is missing a valid transaction ID or passphrase");
  }
  return bundle as RecoveryBundle;
}
