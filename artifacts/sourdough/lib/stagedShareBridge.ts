import { NativeModules, Platform } from 'react-native';

export interface StagedShareItem {
  id: string;
  rawContent: string;
  subject?: string;
  sharedAt: string;
}

const { StagedShareBridgeModule } = NativeModules;

/**
 * Narrow bridge function to safely read and clear native staged share payloads.
 * GUARANTEE: Web, iOS, and mock/test safe fallback.
 */
export async function getAndClearStagedShares(): Promise<StagedShareItem[]> {
  if (Platform.OS !== 'android' || !StagedShareBridgeModule) {
    return [];
  }

  try {
    const jsonStr: string = await StagedShareBridgeModule.getAndClearStagedShares();
    if (!jsonStr || !jsonStr.trim()) return [];
    const parsed = JSON.parse(jsonStr);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_e) {
    return [];
  }
}
