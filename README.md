# Baker's Bench - App Documentation

This document serves as the technical documentation for the Bread Lab application (the-bakers-bench branch).

## 1. App Structure: (tabs) Directory

The `app/(tabs)` directory contains the primary route entry points for the application's tab-based navigation, managed by Expo Router.

### Primary Hubs (Visible Tabs)

#### [bench.tsx]
- **Overall Purpose**: The primary workspace of the app (The Bench). It handles active baking and feeding sessions.
- **Major Functions**:
    - `IndexRoute`: The default export that renders the `BenchHub` component.
- **Import/Usage**:
    - Referenced by `_layout.tsx` as the default `bench` tab (`initialRouteName`).
    - Navigated to by `app/index.tsx` (the splash/welcome screen).

#### [lab.tsx]
- **Overall Purpose**: Serves as the entry point for the **Lab** tab. It acts as a lightweight wrapper for the `LabHub` component.
- **Major Functions**:
    - `LabRoute`: The default export that renders the `LabHub` component.
- **Import/Usage**:
    - Imported/Referenced by `_layout.tsx` as the `lab` tab.

#### [logbook.tsx]
- **Overall Purpose**: Entry point for the **Logbook** feature, which manages personal baking logs or notes.
- **Major Functions**:
    - `LogbookRoute`: The default export that renders the `LogbookHub` component.
- **Import/Usage**:
    - Referenced by `_layout.tsx` as the `logbook` tab.

### Secondary Routes (Hidden Tabs)

#### [graph.tsx]
- **Overall Purpose**: Provides data visualization and analytics for starter health.
- **Major Functions**:
    - `GraphScreen`: The main component managing chart data and layout.
- **Import/Usage**:
    - Defined as a hidden route in `_layout.tsx`.

#### [recipe.tsx]
- **Overall Purpose**: A complex screen for managing the "Recipe Builder" and "Recipe Runner."
- **Import/Usage**:
    - Defined as a hidden route in `_layout.tsx`.

---

## 2. Component Architecture

The app follows a modular component structure, organized by feature hubs.

### Bench Components (`components/bench`)
*Execution workspace logic.*

- **[benchHub.tsx]**: Layout controller for the Bench tab; toggles between Feed and Bake modes.
- **[ActiveBakeSection.tsx]**: Controller for recipe execution, managing phase progression and storage sync.
- **[ActiveFeedSection.tsx]**: Manages starter feed sessions, including the "New Starter" flow.

### Feed Components (`components/feed`)
*Starter maintenance tools.*

- **[FeedSetupView.tsx]**: Input form for new feed sessions (weights, ratios, photos).
- **[FeedActiveSessionView.tsx]**: Dashboard for active feeds, featuring live timers and pH charts.
- **[PeakWindowAdvisor.tsx]**: Prediction tool that solves for ideal feed weights based on target peak times.

### Lab Components (`components/lab`)
*Analytics and high-level planning.*

- **[labHub.tsx]**: Central hub for the Lab tab; coordinates Feed Planner and Recipe Builder views.
- **[labAnalyticsComponents.tsx]**: Shared UI elements (like Hints) used across analytics charts.

### Log Components (`components/log`)
*History and education.*

- **[logHub.tsx]**: Toggle between Bake History and Resources.
- **[logBook.tsx]**: Calendar-based history viewer.
- **[logManual.tsx]**: Science Hub and user settings (Temp units, Accessibility).

### Recipe Components (`components/recipe`)
*Recipe definition and execution blocks.*

- **[PhaseCard.tsx]**: State-aware UI cards for recipe phases (Pending/Active/Done). Includes the Bulk Dashboard.
- **[ContinuousListInput.tsx]**: High-efficiency text input for ingredient/instruction lists.
- **[RecipeBuilderEditView.tsx]**: Full-screen editor for recipe configuration.

---

## 3. Business Logic & Data Layer (`lib/`)

The `lib/` directory houses the core mathematical models, synchronization logic, and pure utility functions.

### Infrastructure & Sync
- **[supabase.ts]**: Configures the Supabase client with AsyncStorage persistence and auto-refresh for user sessions.
- **[api.ts]**: The primary data gateway. Implements CRUD operations for recipes, feeds, and bakes. It also manages legacy data flattening and cross-device ownership filtering.
- **[auth.ts]**: Handles local storage of authentication tokens and `AuthUser` profiles.
- **[deviceId.ts]**: Generates a persistent unique identifier for the device to link local data before a user identifies.
- **[migrate.ts]**: Orchestrates the "Promotion" flow, migrating local "orphan" data to a cloud account.

### Sourdough Analytics & Prediction
- **[analytics.ts]**: Contains core math for pH curves, including linear interpolation (LERP), mean curve calculation (Vitality), and longitudinal series for Acidification/Lifting indices.
- **[predictions.ts]**: The engine behind the Peak Window Advisor. Trains a model based on historical inoculation ratios and temperatures to predict future fermentation durations.
- **[feedCoordinate.ts]**: Implements the **Feed Coordinate System (FCS)**, mapping metabolic states based on flour workload chapters and hydration slices.
- **[feedUtils.ts]**: Pure utilities for calculating ratio strings and formatting feed timers.

### Recipe & Bake Orchestration
- **[recipeTypes.ts]**: The centralized source of truth for TypeScript interfaces and canonical phase definitions.
- **[recipeStorage.ts]**: Async persistence logic that merges local AsyncStorage reads with Supabase API calls. Handles "tombstoning" for robust deletions.
- **[recipeUtils.ts]**: Display utilities, including the regex-based mass quantity scaler and ingredient metric parsers.
- **[bulkFermentEngine.ts]**: A Proportional-Derivative (PD) engine that calculates real-time fermentation velocity and projects completion times based on volume readings.
- **[bulkFermentUtils.ts]**: Formatting logic for the Bulk Dashboard's countdown and rise progress indicators.
- **[recipeHtml.ts]**: Generates standalone HTML documents for printing and PDF sharing.
- **[recipeMigration.ts]**: Utility for promoting legacy flat-string recipes into the structured Universal Recipe format.

---

## 4. Global State & Contexts (`contexts/`)

The application uses React Context for managing global state that needs to be accessed across multiple tabs and components.

- **[PreferencesContext.tsx]**: Manages user settings for Temperature Units (F/C), Weight Units (g/oz), and Time Formats. Persists changes to local storage automatically.
- **[SyncContext.tsx]**: Provides a global sync status and renders a floating "Sync Toast" notification to inform the user of background data persistence.
- **[FontSizeContext.tsx]**: Implements a global accessibility feature that bypasses default font scaling limits by modifying `defaultProps` on core React Native text components.
- **[TourSlideshowContext.tsx]**: Orchestrates the application's high-level onboarding walkthrough, handling auto-show logic for new installs.
- **[MigrationToastContext.tsx]**: Specifically manages UI feedback during the data "promotion" phase (moving local device data to a cloud account).
- **[TourContext.tsx]**: A legacy/stub context used to maintain compatibility with components that previously used granular Copilot-style tours.

---

## 5. Custom Hooks (`hooks/`)

Custom hooks encapsulate reusable logic, specifically around theming and fermentation timers.

- **[useColors.ts]**: Dynamically resolves design tokens (colors, radius) based on the device's light/dark mode setting.
- **[useActiveBakeTimer.ts]**: A reactive 1-second ticker that tracks the elapsed time for every in-progress phase in an active bake session.
- **[useBulkFermentTimer.ts]**: Specialized timer hook that consumes the `BulkFermentState` to provide a real-time countdown to target or an overtime counter.
