# Supabase Bake-History Audit Report (Issue #69 Read-Only Assessment)

**Branch:** `the-bakers-bench`  
**Mode:** Read-only architectural evidence audit.  
**Scope:** Provenance, methodology, schema definitions, and limitations of the bake-history record audit under Issue #69.

---

## 1. Database Environment & Provenance

- **Target Environment**: The Bread Lab app connects to Supabase via `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY` (`lib/supabase.ts`). When environment variables are absent, the client initializes in offline/local-only mode.
- **Audit Methodology**: Because this architectural assessment was performed under read-only guidelines without executing remote database SQL queries or accessing production/staging credentials, **no live remote database queries were executed**. 
- **Evidence Basis**: Classifications and findings are established via **static schema and lifecycle analysis** of TypeScript definitions (`lib/recipeTypes.ts`), local persistence helpers (`lib/recipeStorage.ts`), and unit test fixtures (`bakeLifecycle.test.ts`), rather than live database row inspection.

---

## 2. Record Counts & Limitations

Because no live SQL query or remote database export script was executed against staging or production instances, exact quantitative record counts are **uncaptured / unknown**:
- **Total records examined**: 0 live remote rows (static code analysis only).
- **Records matching legacy reset pattern**: Uncounted (schema-derived definition only).
- **Ambiguous partial records**: Uncounted.
- **Completed records**: Uncounted.
- **Evidentiary artifacts produced**: 1 (`artifacts/architecture/supabase_bake_history_audit.md`).

---

## 3. Classification Logic & Persisted Schema Evidence

The schema-derived classification criteria distinguishing completed bakes from legacy reset artifacts are supported by the following persisted fields (`lib/recipeTypes.ts`):

1. **Completed Bakes**:
   - **Persisted Fields**: `status: 'completed'`, top-level `completedAt` timestamp, phase records with `completedAt` populated, and an optional `outcome` object (`BakeOutcome` containing ratings and defects).
   - **Evidence**: `archiveBakeWithDiagnostics()` (`lib/recipeStorage.ts`, lines 319–365) stamps `savedAt` and sets `status` upon successful phase completion.
2. **Abandoned / Reset Bakes (Legacy Reset Artifacts)**:
   - **Persisted Fields**: `status: 'completed'` (historically assigned upon reset), missing or null top-level `completedAt`, zero completed phases (`phases.every(p => !p.completedAt)`), and missing `outcome` (`outcome: undefined`).
   - **Evidence**: Former implementations of `handleAbandonBake()` (`ActiveBakeSection.tsx`) and `resetBake()` (`recipe.tsx`) invoked `archiveBakeWithDiagnostics()` unconditionally on active bakes regardless of whether any phases had started or completed.
3. **Ambiguous Records**:
   - Bakes with partial phase progress (e.g., autolyse or mixing started but abandoned before bulk fermentation or baking) may contain some `startedAt` timestamps but lack a final `completedAt`. These remain ambiguous without baker intent context.

---

## 4. Recommendations & Next Steps

- **No Remote Action Taken**: In accordance with read-only guidelines, no remote Supabase records have been modified or deleted.
- **Safe, Bounded Follow-Up**: If cleaning up historical Supabase records is desired, a bounded SQL migration or Supabase edge query can be prepared to target remote rows where `completedAt IS NULL` AND JSON `phases` contain zero completed elements AND `outcome IS NULL`. This should be reviewed and executed manually by the repository owner.
