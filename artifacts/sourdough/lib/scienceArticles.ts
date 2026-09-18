// lib/scienceArticles.ts
import { supabase } from "./supabase";

export type ScienceContentBlock =
  | { type: "paragraph"; text: string; italic?: boolean }
  | { type: "heading"; text: string }
  | { type: "equation"; text: string };

export interface ScienceArticle {
  id?: string;
  slug: string;
  title: string;
  isPublished?: boolean;
  blocks: ScienceContentBlock[];
  furtherStudyTopics: string[];
  createdAt?: string;
  updatedAt?: string;
}

/**
 * Maps Supabase snake_case response to TypeScript camelCase interface
 */
function mapArticle(data: any): ScienceArticle {
  return {
    id: data.id,
    slug: data.slug,
    title: data.is_published === false ? `[DRAFT] ${data.title}` : data.title,
    isPublished: data.is_published,
    blocks: data.blocks,
    furtherStudyTopics: data.further_study_topics,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
  };
}

/**
 * Fetches a single science article by its slug.
 */
export async function fetchScienceArticleBySlug(slug: string): Promise<ScienceArticle> {
  if (!supabase) throw new Error("Supabase client not initialized");

  let query = supabase
    .from("science_articles")
    .select("*")
    .eq("slug", slug);

  if (!__DEV__) {
    query = query.eq("is_published", true);
  }

  const { data, error } = await query.single();

  if (error) {
    throw new Error(`Failed to fetch article [${slug}]: ${error.message}`);
  }

  return mapArticle(data);
}

/**
 * Fetches all published science articles for the hub menu.
 */
export async function fetchPublishedScienceArticles(): Promise<ScienceArticle[]> {
  if (!supabase) return [];

  let query = supabase
    .from("science_articles")
    .select("*");

  if (!__DEV__) {
    query = query.eq("is_published", true);
  }

  const { data, error } = await query.order("created_at", { ascending: false });

  if (error) {
    console.error("Error fetching science articles:", error);
    return [];
  }

  return data.map(mapArticle);
}

/**
 * Extracts a brief summary from the first paragraph block of an article.
 * Used for UI previews to avoid database schema bloat.
 */
export function getArticleSummary(article: ScienceArticle): string {
  const firstParagraph = article.blocks.find(b => b.type === "paragraph");
  if (!firstParagraph) return "";

  const text = firstParagraph.text;
  return text.length > 120 ? text.substring(0, 117) + "..." : text;
}
