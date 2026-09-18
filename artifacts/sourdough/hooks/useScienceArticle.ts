// hooks/useScienceArticle.ts
import { useQuery } from "@tanstack/react-query";
import { fetchScienceArticleBySlug, fetchPublishedScienceArticles } from "@/lib/scienceArticles";

/**
 * Hook to fetch a single science article by slug.
 */
export function useScienceArticle(slug: string) {
  return useQuery({
    queryKey: ["scienceArticle", slug],
    queryFn: () => fetchScienceArticleBySlug(slug),
    staleTime: __DEV__ ? 0 : 1000 * 60 * 60 * 24, // 0 in dev for real-time edits, 24 hours in prod
  });
}

/**
 * Hook to fetch all published science articles for listing.
 */
export function useScienceArticles() {
  return useQuery({
    queryKey: ["scienceArticles"],
    queryFn: () => fetchPublishedScienceArticles(),
    staleTime: __DEV__ ? 0 : 1000 * 60 * 60 * 24, // 0 in dev for real-time edits, 24 hours in prod
  });
}
