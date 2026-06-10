import { listLocalGmailSenders, mirrorGmailConnectionToCentralData } from "@/src/domains/gmail";
import { loadUserTokens } from "@/src/domains/local-store";

export async function tryCentralData(label: string, fn: () => Promise<any>) {
  try {
    const result = await fn();
    return { ok: true, result };
  } catch (err: any) {
    console.warn(`[Central Data Error] ${label}: ${err.message}`);
    return { ok: false, error: err.message };
  }
}

export async function backfillCentralData() {
  const localSenders = listLocalGmailSenders();
  const summary: any = { migrated: 0, skipped: 0, errors: [] };

  for (const tokenStoreKey of Object.keys(localSenders)) {
    if (!tokenStoreKey.startsWith("firebase:")) {
      summary.skipped++;
      continue;
    }
    const safeUid = tokenStoreKey.slice(9);
    try {
      const tokens = loadUserTokens(tokenStoreKey);
      if (tokens) {
        await mirrorGmailConnectionToCentralData(safeUid, tokens);
        summary.migrated++;
      } else {
        summary.skipped++;
      }
    } catch (err: any) {
      summary.errors.push({ uid: safeUid, error: err.message });
    }
  }

  return summary;
}
