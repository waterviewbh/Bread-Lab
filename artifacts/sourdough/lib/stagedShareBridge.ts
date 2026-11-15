import { NativeModules, Platform } from 'react-native';

export interface StagedShareItem {
  id: string;
  rawContent: string;
  subject?: string;
  sharedAt: string;
}

const { StagedShareBridgeModule } = NativeModules;

/** The existing native peek claims unowned shares for the departing workspace. */
export async function hasStagedShares(owner: string): Promise<boolean> {
  return (await peekStagedShares(owner)).length > 0;
}

/** Reads and claims native staging for the current owner. A missing bridge or unreadable queue is an error. */
export async function peekStagedShares(owner: string): Promise<StagedShareItem[]> {
  if (Platform.OS !== 'android') return [];
  if (!owner || !owner.trim()) throw new Error('A workspace owner is required to inspect staged shares.');
  if (typeof StagedShareBridgeModule?.peekStagedShares !== 'function') {
    throw new Error('Native staged-share peek is unavailable; rebuild the Android app.');
  }
  const raw: string = await StagedShareBridgeModule.peekStagedShares(owner);
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed) || parsed.some((item) =>
    !item || typeof item !== 'object' || typeof item.id !== 'string' || !item.id.trim() ||
    typeof item.rawContent !== 'string' || typeof item.sharedAt !== 'string'
  )) {
    throw new Error('Native staged shares are unreadable; staging was left untouched.');
  }
  const items = parsed as StagedShareItem[];
  if (new Set(items.map((item) => item.id)).size !== items.length) {
    throw new Error('Native staged shares contain duplicate IDs; staging was left untouched.');
  }
  return items;
}

/** Removes only IDs whose Candidate was durably written and verified. Safe to retry after a crash. */
export async function acknowledgeStagedShares(ids: string[], owner: string): Promise<void> {
  if (ids.length === 0 || Platform.OS !== 'android') return;
  if (!owner || !owner.trim()) throw new Error('A workspace owner is required to acknowledge staged shares.');
  if (typeof StagedShareBridgeModule?.acknowledgeStagedShares !== 'function') {
    throw new Error('Native staged-share acknowledgement is unavailable; rebuild the Android app.');
  }
  if (ids.some((id) => typeof id !== 'string' || !id.trim())) {
    throw new Error('Cannot acknowledge a staged share without an ID.');
  }
  await StagedShareBridgeModule.acknowledgeStagedShares(ids, owner);
}
