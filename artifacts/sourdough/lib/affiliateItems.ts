// lib/affiliateItems.ts
import { supabase } from "@/lib/supabase";

export interface AffiliateItem {
  id: string;
  name: string;
  image_url: string;
  affiliate_url: string;
  display_weight: number;
}

// Fetches all active affiliate items, ordered by display_weight ascending.
// Returns an empty array on any error so the carousel silently disappears.
export async function fetchAffiliateItems(): Promise<AffiliateItem[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("affiliate_items")
    .select("id, name, image_url, affiliate_url, display_weight")
    .eq("is_active", true)
    .order("display_weight", { ascending: true });
    if (error) {
      console.warn("[affiliateItems] fetch error:", error.message);
      return [];
    }
  return data ?? [];
}