// lib/affiliateItems.ts
import { supabase } from "@/lib/supabase";

export interface AffiliateItem {
  id: string;
  name: string;
  image_url: string;
  affiliate_url: string;
  display_weight: number;
  tab_shown?: "runner" | "feed" | null;
  tutorial_milestone?: string | null;
  description?: string | null;
}

interface FetchOptions {
  tab?: "feed" | "runner";
  milestone?: string;
}

// Fetches curated affiliate items based on the current page (tab) or tutorial milestone.
export async function fetchAffiliateItems(options?: FetchOptions): Promise<AffiliateItem[]> {
  if (!supabase) return [];

  let query = supabase
    .from("affiliate_items")
    .select("id, name, image_url, affiliate_url, display_weight, tab_shown, tutorial_milestone")
    .eq("is_active", true);

  if (options?.milestone) {
    // Exact match for tutorial milestones (e.g. 'ph-meter')
    query = query.eq("tutorial_milestone", options.milestone);
  } else if (options?.tab === "feed") {
    // Feed Tracker: show 'feed' items, global items (NULL), and all tutorial items
    query = query.or("tab_shown.eq.feed,tab_shown.is.null,tutorial_milestone.not.is.null");
  } else if (options?.tab === "runner") {
    // Active Bake: show 'runner' items and global items (NULL) only
    query = query.or("tab_shown.eq.runner,tab_shown.is.null");
  }

  const { data, error } = await query.order("display_weight", { ascending: true });

  if (error) {
    console.warn("[affiliateItems] fetch error:", error.message);
    return [];
  }
  return data ?? [];
}
