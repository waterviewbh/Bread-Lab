# Task: Fix Recipe Runner Errors and Populate Supabase Metrics

- [ ] UI Fixes (Recipe Runner) [STUCK: No write permission, providing chunks in chat]
    - [/] [MODIFY] `RecipeRunnerSetupView.tsx`: Join array ingredients for preview.
    - [ ] [MODIFY] `recipe.tsx`: Fix string operations on objects.
- [ ] Data Model & Utilities
    - [ ] [MODIFY] `recipeTypes.ts`: Add metrics to `SavedRecipe`.
    - [ ] [MODIFY] `recipeUtils.ts`: Implement `calculateRecipeMetrics`.
- [ ] API & Backend
    - [ ] [MODIFY] `api.ts`: Update client-side API interfaces and calls.
    - [ ] [MODIFY] `recipes.ts` (Drizzle): Add columns to database schema.
    - [ ] [MODIFY] `recipes.ts` (API Route): Update validation and persistence logic.
- [ ] Documentation
    - [ ] [MODIFY] `Universal JSON Card 1.2.0 Walkthrough.artifact.md`: Add corrective actions.
- [ ] Verification
    - [ ] Create scratch script for calculation logic.
    - [ ] Verify build/types.
