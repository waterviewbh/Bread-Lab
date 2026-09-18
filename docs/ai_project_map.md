# 🤖 AI Project Map — Bread Lab

This concise map provides instant architectural orientation for AI assistants. Do not perform recursive directory scans at session startup.

## 📂 Repository Layout

Bread Lab is a pnpm monorepo workspace containing the primary application and supporting shared library folders.

```
E:/Bread-Lab/
├── artifacts/sourdough/      # 📱 Primary React Native / Expo Mobile App
├── lib/                      # 🛠️ Shared Data & API layer packages
│   ├── db/                   # Database schemas / definitions
│   ├── api-zod/              # Validation contracts using Zod
│   ├── api-spec/             # OpenAPI / API specifications
│   └── api-client-react/     # TanStack React Query client library
├── docs/                     # 📝 Project Knowledge Base & Logs
├── android/                  # Native Android project configuration
└── package.json              # Workspace private root configurations
```

---

## 📱 Application Architecture (`artifacts/sourdough/`)

The mobile codebase follows a feature-hub architecture built on top of Expo Router and React Native.

### 1. Tab Routing Hubs (`app/(tabs)/`)
*   `bench.tsx` (The Bench): Default workspace for active dough baking and starter feeding sessions. Toggles between Feed and Bake modes.
*   `lab.tsx` (The Lab): Hub for analytics dashboards, insights, Feed Planner, and Formula recipes.
*   `log.tsx` (The Log): View historical baking records, resource articles, and user settings.
*   `recipe.tsx` (Hidden Tab): Complex screen housing the recipe builder workspace and execution runner.

### 2. Component Design (`components/`)
*   `components/bench/`: Active execution modules (`ActiveBakeSection`, `ActiveFeedSection`, layout controller).
*   `components/feed/`: Forms, active feed tracking dashboards, and the predictive `PeakWindowAdvisor`.
*   `components/lab/`: Layout coordinators for dashboards and analytics charts.
*   `components/log/`: Calendar log visualizers and configuration sheets.
*   `components/recipe/`: `RecipeDeck` (overlapping index tabs), state-aware `PhaseCard` lists, and high-efficiency text fields (`ContinuousListInput`).

### 3. Business Logic & Core Engines (`lib/`)
*   `recipeTypes.ts`: Single source of truth for all recipe and bake data shapes, interfaces, and canonical phase keys.
*   `recipeStorage.ts`: Dual-sync persistence layer coordinating local `AsyncStorage` cache with Supabase API. Supports tombstoning.
*   `recipeUtils.ts`: Mathematical display helpers, quantity/mass text scalers, and ingredient token metrics parsers.
*   `bulkFermentEngine.ts`: Real-time Proportional-Derivative (PD) model predicting fermentation peak velocity and completion countdowns.
*   `recipeHtml.ts`: Generates standalone responsive HTML documents for local system printing or PDF exports.
*   `recipeMigration.ts`: Utilities for lossless automated promotion of legacy text blobs to structured `CheckableLine` objects.
*   `scienceArticles.ts`: API layer for dynamic scholarly content management, coordinating Supabase fetches with local offline fallbacks.

### 4. Global State Layers (`contexts/` & `hooks/`)
*   `contexts/`: Manages system-wide states such as synchronization notifications (`SyncContext`), dynamic responsive themes (`PreferencesContext`), and accessibility overrides (`FontSizeContext`).
*   `hooks/`: Shared reactive hook utilities (`useColors` for design tokens, `useActiveBakeTimer` for phase tickers).

---

## 🏗️ Technical Constraints to Remember
*   **Universal Card Architecture**: Content text lines are parsed into rich `CheckableLine` structs instead of plain text strings to enable interactive checklist workflows.
*   **Reanimated Worklets**: Ensure plugins list in `babel.config.js` places `react-native-reanimated/plugin` at the exact end of the block to prevent worklet transpile exceptions on Web targets.
*   **Global Text Selectability**: To support further study and data extraction, all educational, descriptive, and user-generated text blocks must set `selectable={true}`. This includes article paragraphs, equations, and active journal notes.
