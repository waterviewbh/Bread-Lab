// artifacts/sourdough/lib/nlaBoundary.ts
//
// NLA (Nameless Lab Assistant) is the signed-out workspace. By the owner's decision it knows nothing
// about Supabase: NLA-reachable operations must not even ATTEMPT to communicate with it, rather than
// merely failing authentication. This module holds the primitives that enforce and document that rule.
//
// In code the NLA owner is the literal string "anonymous" (see recipeStorage.resolveOwner).

export const NLA_OWNER = "anonymous";

export function isNlaOwner(owner: string | null | undefined): boolean {
  return owner === NLA_OWNER;
}

/**
 * Thrown, before any network request is made, when an operation that requires an account is attempted
 * from the NLA workspace. Callers must treat it like being offline: keep and show local data, and never
 * present it as an empty remote dataset.
 */
export class NlaSupabaseBoundaryError extends Error {
  constructor(operation: string) {
    super(`NLA workspace must not communicate with Supabase (${operation}).`);
    this.name = "NlaSupabaseBoundaryError";
  }
}

/**
 * The ONLY sanctioned exceptions to "NLA never touches Supabase". Anything not listed here that an
 * NLA-reachable path does is a violation (see lib/__tests__/nlaBoundary.test.ts, which also fails if
 * this list drifts from the code).
 */
export const NLA_SUPABASE_EXCEPTIONS = [
  {
    id: "public-catalogs",
    description:
      "Read-only public catalog content (affiliate_items, science_articles). Shared content, not baker-owned " +
      "workspace data. Basic offline baking must not depend on its availability. No catalog redesign in CLI-4.",
  },
  {
    id: "sign-in-and-sign-out",
    description:
      "The sign-in and sign-out calls themselves (api.auth.*): this is how a baker leaves the NLA workspace.",
  },
  {
    id: "import-under-destination-session",
    description:
      "The explicit Import and Proceed upload and read-back, which run under the destination account's " +
      "authenticated session after the baker has chosen to transfer their offline workspace.",
  },
] as const;
