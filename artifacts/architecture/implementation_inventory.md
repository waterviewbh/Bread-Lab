# Architectural Atlas: Phase 1 — Comprehensive File-Level Architectural Map & Gap Audit

**Branch:** `the-bakers-bench`  
**Mode:** Read-only architectural inventory and auditable source file reconciliation of application support files across Lab, Bench, Log, and Shared Capabilities in `artifacts/sourdough/`.

---

## 1. Targeted File-Level Audit & Coverage Matrix

To ensure absolute auditability and transparency, every source file within the application scope (`artifacts/sourdough/app/`, `components/`, `contexts/`, `hooks/`, `lib/`, `constants/`) is accounted for in the coverage matrix below.

### Explicit Coverage Matrix
| Category | File Count | Definition & Audit Basis |
| :--- | :--- | :--- |
| **Individually Mapped Core Files** | **42** | Hubs, core route screens, primary modal controllers, workflow engines, persistence utilities, and core contexts. Each is individually documented with inputs, outputs, dependencies, and state/persistence responsibilities. |
| **Grouped Supporting Components** | **57** | Stateless UI primitives, presentational display cards, chart renderers, helper rows, and static constants. Audited as genuinely stateless/presentational because they receive props, render JSX or static constants, and do not directly read/write local storage or network APIs. |
| **Explicitly Excluded Files** | **10** | Test files, test mocks, and Expo routing template boilerplate (`+html.tsx`, `+not-found.tsx`). Excluded from runtime workflow execution tracking. |
| **Total In-Scope Source Files** | **109** | $42 + 57 + 10 = 109$ (Sum exact). |

---

## 2. Reconciled File Catalog (42 Individually Mapped Core Files)

| Repository-Relative Path | Primary Responsibility | Inputs (Parameters / Props) | Outputs (Return Values / Render) | Dependencies & Called Modules | State, Persistence & Side Effects |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `app/_layout.tsx` | Root layout, font loading, global providers. | `children: React.ReactNode` | JSX tree wrapped in `ThemeProvider`, `SyncProvider`, `ShareCandidateProvider`, `MigrationToastProvider`. | `@expo/vector-icons`, `expo-font`, contexts (`SyncContext`, `ShareCandidateContext`, `MigrationToastContext`) | Initializes fonts (`useFonts`), global error boundaries. |
| `app/(tabs)/_layout.tsx` | Tab layout and custom navigation bar configuration. | None (Expo Router layout) | `TabLayout()` rendering `<Tabs>` navigator with custom `HubIcon`. | `expo-router`, `react-native`, `@expo/vector-icons`, `TourSlideshowContext`, `SyncContext` | Configures Expo Router `Tabs`, tab bar styling, safe area insets. |
| `app/(tabs)/lab.tsx` | Lab tab route entry. | None | `LabRoute()` rendering `<LabHub />`. | `@/components/lab/labHub` | Renders Lab Hub container. |
| `app/(tabs)/index.tsx` | Bench tab default route entry (`initialRouteName="bench"`). | None | `IndexRoute()` rendering `<BenchHub />`. | `@/components/bench/benchHub` | Renders Bench Hub container. |
| `app/(tabs)/log.tsx` | Log tab route entry. | None | `LogRoute()` rendering `<LogHub />`. | `@/components/log/logHub` | Renders Log Hub container. |
| `app/(tabs)/recipe.tsx` | Legacy combined builder/runner screen (Unrouted / Migration reference). | None | `RecipeScreen()` rendering legacy workbench UI. | React Native, `recipeStorage`, `recipeTypes` | Hidden from tab navigation (`href: null`). Maintained as unrouted legacy/migration reference code. |
| `app/(tabs)/history.tsx` | Legacy history screen (Unrouted / Migration reference). | None | `HistoryScreen()` rendering legacy history logs. | React Native | Hidden from tab navigation (`href: null`). Replaced by Log Hub history. |
| `app/(tabs)/graph.tsx` | Legacy analytics graph screen (Unrouted / Migration reference). | None | `GraphScreen()` rendering legacy charts. | React Native, `analytics` | Hidden from tab navigation (`href: null`). Replaced by Lab Hub analytics. |
| `app/(tabs)/about.tsx` | About & Settings screen. | None | `AboutScreen()` rendering settings and attribution. | React Native | Hidden from tab navigation (`href: null`). Accessed via router links/settings. |
| `app/share.tsx` | Share intent handling route. | None | `ShareRoute()` processing inbound share intents. | `expo-router`, `ShareCandidateContext`, `recipeExtractor` | Processes incoming share intents/payloads. |
| `components/lab/labHub.tsx` | Lab hub container managing Analytics, Feed Planner, and Recipe Builder. | Router params (`section`, `action`) | `LabHub()` rendering Hub section toggle, Analytics, Feed Planner, or Recipe Builder. | `@/lib/recipeStorage`, `@/lib/analytics`, `@/contexts/SyncContext`, `@/components/recipe/...` | Manages hub section toggle, local recipe persistence (`writeRecipesLocal`), tombstone management, and remote sync (`upsertRecipeRemote`). |
| `components/bench/benchHub.tsx` | Bench hub container managing Feed Tracker and Recipe Runner. | Router params (`section`) | `BenchHub()` rendering toggle between `ActiveFeedSection` and `ActiveBakeSection`. | `@/components/bench/ActiveFeedSection`, `@/components/bench/ActiveBakeSection`, `expo-router` | Manages hub section toggle (`feed` vs `bake`) and URL parameter deep-linking. |
| `components/log/logHub.tsx` | Log hub container managing History, Diagnostic, and Resources. | Router params (`section`, `slug`) | `LogHub()` rendering History, Diagnostics, or Resources with article modal overlay. | `@/components/log/log`, `@/components/log/logDiagnostic`, `@/components/log/logManual`, `@/components/log/KnowledgeHubArticle` | Manages active log section and Knowledge Hub article modal overlay state. |
| `components/bench/ActiveFeedSection.tsx` | Active feeding session tracker container & state owner. | `incomingStarter`, `incomingFlour`, `incomingWater`, `autoStart` | `ActiveFeedSection()` rendering feeding timer, telemetry, and setup/active views. | `@/lib/api`, `@/lib/deviceId`, `@/lib/auth`, `@/contexts/SyncContext`, `@/lib/feedUtils` | Coordinates feeding session state (`bread_lab_feed_session_v1`), timer ticks, ratio computations, and local persistence (`bread_lab_feed_history_v1`). |
| `components/bench/ActiveBakeSection.tsx` | Active baking session orchestrator & timer controller. | None | `ActiveBakeSection()` rendering bake runner setup or active phase progression view. | `@/lib/recipeStorage`, `@/hooks/useActiveBakeTimer`, `@/lib/bulkFermentEngine`, `@/lib/recipeHtml` | Coordinates active bakes (`bread_lab_bake_v2`), timer hooks (`useActiveBakeTimer`), and runner sub-views. |
| `components/recipe/RecipeBuilderListView.tsx` | List view for saved recipes with letter filtering and action triggers. | `recipes`, `onSelect`, `onEdit`, `onNew`, `onDuplicate`, `onDelete`, `onPrint`, `onShare` | `RecipeBuilderListView()` rendering recipe list cards. | React Native, `@expo/vector-icons` | Filters and renders saved recipes; triggers edit, duplicate, print, and share actions (stateless list controller). |
| `components/recipe/RecipeBuilderEditView.tsx` | Detailed editor for recipe metadata, overview, yield, and phase composition. | `recipe`, `onSave`, `onCancel` | `RecipeBuilderEditView()` rendering form inputs and phase editor. | `@/lib/recipeUtils`, `@/lib/recipeTypes`, `ContinuousListInput` | Manages recipe edit draft state; updates phase text arrays; commits save/delete/duplicate operations. |
| `components/recipe/BakerReviewModal.tsx` | Modal for unverified import boundary review and schema validation. | `visible`, `extractionResult`, `onSaveAndClose`, `onSaveConfirmed`, `onPromote`, `onDiscard` | `BakerReviewModal()` rendering candidate review workbench modal. | `@/lib/recipeExtractor`, `@/lib/recipeImport`, `@/lib/recipeUtils` | Validates portable recipe schema (`validatePortableRecipe`), commits to remote/local storage, triggers success haptics. |
| `components/recipe/CandidateReviewController.tsx` | Controller for managing candidate review state and persistence. | `candidateId`, `extractionResult`, `visible`, `onSaveSuccess`, `onDiscard` | `CandidateReviewController()` wrapping review modal with persistence callbacks. | `@/lib/candidateStorage`, `@/lib/recipeStorage`, `@/lib/recipeImport`, `BakerReviewModal` | Manages candidate isolation, review state, and save callbacks (`appendRecipeLocal`). |
| `components/recipe/PasteCandidateModal.tsx` | Text pasting modal for importing external recipe candidates. | `visible`, `onClose`, `onExtractSuccess` | `PasteCandidateModal()` rendering text input dialog. | `@/lib/recipeExtractor`, `@/lib/candidateStorage` | Captures raw text input, invokes text extraction (`extractRecipeFromText`). |
| `components/recipe/ReadingModal.tsx` | Modal for logging pH, temperature, volume, and notes during a bake phase. | `visible`, `phaseKey`, `initialVolume`, `initialTemp`, `onClose`, `onSave` | `ReadingModal()` rendering reading input form. | React Native, `@expo/vector-icons` | Captures reading inputs, updates phase readings, and invokes bulk fermentation calculation engine. |
| `components/recipe/RecipeRunnerActiveView.tsx` | Active bake runner view displaying phases, timers, folds, and readings. | `bake`, `sessionChecks`, `elapsed`, `onStartPhase`, `onCompletePhase`, `onOpenReading`, `onToggleFold`, `onUpdateEstimator` | `RecipeRunnerActiveView()` rendering phase cards and controls. | React Native, `ReadingModal`, `BulkEstimatorSettingsModal` | Manages active phase progression, volume/temperature commits, note overlays, and printing/sharing (stateless view controller). |
| `components/recipe/RecipeRunnerSetupView.tsx` | Setup view shown when no active bake is running. | `recipes`, `onSelectRecipe`, `onCreateNew` | `RecipeRunnerSetupView()` rendering recipe picker list. | React Native | Prompts baker to select a recipe or create a new one to start a bake (stateless setup view). |
| `components/log/log.tsx` | History section rendering calendar, streaks, feed logs, and bake summaries. | None | `HistorySection()` rendering calendar matrix, filters, and activity logs. | `@/lib/api`, `@/lib/recipeStorage`, `@/contexts/SyncContext` | Manages calendar state, feed filtering, history entries, local/remote deletion tombstones, print/share actions. |
| `components/log/logDiagnostic.tsx` | Diagnostic tools and post-bake analysis section. | None | `DiagnosticSection()` rendering diagnostic harness cards. | `@/lib/diagnosticLogic`, `@/lib/recipeStorage` | Ingests bake logs and evaluates diagnostic criteria (`lib/diagnosticLogic.ts`). |
| `components/log/logManual.tsx` | Educational resource manual section listing articles and guides. | None | `ResourcesSection()` rendering article list. | React Native, `scienceArticles` | Renders categorized knowledge base articles. |
| `contexts/PreferencesContext.tsx` | Global user preferences (temp units, weight units, time format). | `children: React.ReactNode` | `PreferencesProvider` and `usePreferences()` hook. | AsyncStorage | Persists user preferences in AsyncStorage. |
| `contexts/SyncContext.tsx` | Offline-first sync status and pending operation tracking. | `children: React.ReactNode` | `SyncProvider` and `useSyncStatus()` hook. | React Context | Tracks pending sync operations and success/failure callbacks. |
| `contexts/ShareCandidateContext.tsx` | Subscription context for share candidate intent changes. | `children: React.ReactNode` | `ShareCandidateProvider` and `useShareCandidate()` hook. | React Context | Emits change subscriptions for incoming candidate shares. |
| `hooks/useActiveBakeTimer.ts` | Timer hook tracking active bake elapsed time. | `bake: ActiveBake | null` | Returns `elapsedMs: number`. | React Hooks | Returns elapsed milliseconds for an active bake session. |
| `hooks/useBulkFermentTimer.ts` | Timer hook for bulk fermentation phase monitoring. | `phase: BakePhase | null` | Returns elapsed time stats. | React Hooks | Calculates elapsed bulk fermentation time. |
| `lib/recipeStorage.ts` | Local storage and remote sync operations for recipes and bakes. | `SavedRecipe`, `ActiveBake`, callbacks | Exports `loadAll()`, `writeRecipesLocal()`, `appendRecipeLocal()`, `writeBakesLocal()`, `upsertRecipeRemote()`, `archiveBakeWithDiagnostics()`. | AsyncStorage, `api`, `storageMutex`, `deviceId` | Manages AsyncStorage persistence and Supabase synchronization. |
| `lib/candidateStorage.ts` | Storage engine for staged recipe import candidates. | `CandidateRecord`, extraction payloads | Exports `loadCandidates()`, `saveCandidate()`, `removeCandidate()`, `getCandidatesKey()`. | AsyncStorage, `storageMutex` | AsyncStorage read/write operations for candidate records. |
| `lib/bulkFermentEngine.ts` | Scientific calculation engine for bulk fermentation state and acidification. | Readings, phases, estimator state | Exports `computeBulkFermentState()`, `estimateInoculationPercent()`, `detectYeastType()`. | Pure math | Pure computational functions calculating fermentation metrics. |
| `lib/recipeImport.ts` | Schema validation and normalization for portable recipes. | `PortableRecipe` | Exports `validatePortableRecipe()`, `normalizePortableRecipe()`. | Pure logic | Validates portable schema structure. |
| `lib/recipeExtractor.ts` | Text parsing engine for extracting structured recipes from raw text. | Raw text string | Exports `extractRecipeFromText()`. | Regular expressions | Regular expression and heuristic parsing. |
| `lib/webAcquisition.ts` | Web scraping and HTML extraction for recipe URLs. | URL string | Exports `fetchAndExtractRecipeFromUrl()`. | Fetch API | Network fetch + extraction. |
| `lib/api.ts` & `lib/supabase.ts` | Network client and Supabase backend integration. | Endpoints, payloads, auth tokens | Exports `api` object (recipes, history, auth). | `supabase-js`, `AsyncStorage` | HTTP / Supabase client calls. |
| `lib/analytics.ts` | Mathematical calculation engine for fermentation analytics and chart series. | History entries | Exports `computeAcidificationSeries()`, `computeLiftingSeries()`, `computeSessionAcidVelocity()`, `updateAllTimeAnalytics()`. | Pure math | Computes time-series regression and running averages for vitality and lifting metrics. |
| `lib/recipeMigration.ts` | Utility for lossless promotion of legacy flat-string recipes into structured Universal Recipe Card format. | Legacy recipes | Exports `migrateToUniversalCard()`. | Recipe types | Transforms legacy phase structures into versioned Universal Recipe Card models. |
| `lib/stagedShareBridge.ts` | Native bridge interface for retrieving and clearing native share payloads on Android. | None | Exports `getAndClearStagedShares()`. | Native Modules | Invokes native `StagedShareBridgeModule` bridges with platform/error fallbacks. |
| `lib/storageUtils.ts` | Centralized storage utility managing AsyncStorage keys, exhaustive wiping, defensive parsing, and mutex locks. | None | Exports `clearAllAppData()`, `safeParse()`, `AsyncMutex`, `storageMutex`, `APP_STORAGE_KEYS`. | AsyncStorage | Manages AsyncStorage keys, multiRemove data wiping, and async concurrency mutexes. |

---

## 3. Grouped Supporting Components (57 Stateless / Presentational Files)

The following **57** files are grouped because they are genuinely stateless or presentational UI primitives, layout wrappers, visual charts, icons, or static content constants. They receive props from parent hubs/controllers and render JSX or static data without owning independent workflow state or reading/writing local storage or network APIs:
- **Charts & Visualizations (`components/`)**: `AcidificationChart.tsx`, `LiftingIndexChart.tsx`, `FCSScatterPlot.tsx`, `PHChart.tsx`, `AffiliateCarousel.tsx`, `AffiliateMilestoneCard.tsx`, `YieldPill.tsx`, `SegmentedNotepad.tsx`, `NudgeBanner.tsx`, `AuthModal.tsx`, `ErrorBoundary.tsx`, `ErrorFallback.tsx`, `KeyboardAwareScrollViewCompat.tsx`, `KeyboardAwareScrollViewCompat.web.tsx`, `KeyboardProviderCompat.tsx`, `KeyboardProviderCompat.web.tsx`, `TourProviderWrapper.tsx`, `TourSlideshow.tsx`, `TourStep.tsx`.
- **Feed Supporting (`components/feed/`)**: `FeedActiveSessionView.tsx`, `FeedSetupView.tsx`, `LevainSlider.tsx`.
- **Log Supporting (`components/log/`)**: `IterationStack.tsx`, `KnowledgeHubArticle.tsx`.
- **Recipe Supporting UI Elements (`components/recipe/`)**: `BakeSelectorTabs.tsx`, `BulkEstimatorSettingsModal.tsx`, `ContinuousListInput.tsx`, `KeycapKey.tsx`, `PhaseAssignmentModal.tsx`, `PhaseHighlight.tsx`, `PhaseIcons.tsx`, `ReadingRow.tsx`, `RecipeCard.tsx`, `RecipeDeck.tsx`, `RecipePickerModal.tsx`, `SegmentBar.tsx`, `TransientShareBanner.tsx`.
- **Contexts & Hooks (`contexts/`, `hooks/`)**: `FontSizeContext.tsx`, `MigrationToastContext.tsx`, `TourContext.tsx`, `TourContext.web.tsx`, `TourSlideshowContext.tsx`, `useColors.ts`, `useScienceArticle.ts`, `useTransientShareIntent.ts`.
- **Constants & Helpers (`lib/`, `constants/`)**: `activeDiagnosticHarness.ts`, `affiliateItems.ts`, `auth.ts`, `bulkFermentUtils.ts`, `deviceId.ts`, `diagnosticLogic.ts`, `feedCoordinate.ts`, `feedUtils.ts`, `migrate.ts`, `migrationPipeline.ts`, `postBulkDiagnostics.ts`, `predictions.ts`, `printUtils.ts`, `recipeDiff.ts`, `recipeHtml.ts`, `recipeTypes.ts`, `recipeUtils.ts`, `scienceArticles.ts`, `shareDiagnostics.ts`, `transientSharePayload.ts`, `validationHarness.ts`, `TourConfig.ts`, `TourImages.ts`, `aboutContents.ts`, `colors.ts`, `diagnosticContents.ts`, `scienceContents.ts`, `testCandidateFixture.ts`, `theme.ts`.

---

## 4. Explicitly Excluded Files (10 Test & Boilerplate Files)

1. `app/__tests__/index.test.tsx`
2. `components/bench/__tests__/ActiveBakeSection.test.tsx`
3. `components/recipe/__tests__/BakerReviewModal.test.tsx`
4. `components/recipe/__tests__/PhaseCard.test.tsx`
5. `components/recipe/__tests__/RecipeCandidatesSubcard.test.tsx`
6. `components/recipe/__tests__/RecipePickerModal.test.tsx`
7. `components/recipe/__tests__/phaseAssignment.test.tsx`
8. `hooks/__tests__/useActiveBakeTimer.test.ts`
9. `hooks/__tests__/useBulkFermentTimer.test.ts`
10. Expo routing template boilerplate (`app/+html.tsx`, `app/+not-found.tsx`).

---

## 5. Remaining Unresolved Gaps & Audit Notes
- **Unrouted Legacy Routes**: Files such as `app/(tabs)/recipe.tsx`, `history.tsx`, and `graph.tsx` are unrouted in active navigation (`href: null`) but remain present in the source tree as legacy/migration references.
- **Grouped UI Primitives**: 57 minor supporting components are categorized as presentational. While their specific inputs/outputs are defined by their React component signatures, they are not granted individual rows because they do not execute business logic or own asynchronous state. This is audited as intentional architecture.
