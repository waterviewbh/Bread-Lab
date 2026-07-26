## Summary of the files in Bread-Lab

### Root Layout & Configuration

_Located in artifacts/sourdough/app/:_
- `_layout.tsx`: The primary entry point for the native application. It initializes global providers (Theming, Sync, Font sizing), manages font loading, and controls the splash screen.
- `_layout.web.tsx`: A platform-specific layout for the web version, optimized for browser performance by using CSS-based font injection and omitting native-only UI components.
- `+html.tsx`: Defines the root HTML structure for the web build, including SEO meta tags, Open Graph properties, and social sharing metadata.
- `+not-found.tsx`: The fallback screen for invalid routes, providing users with a way to navigate back to the home screen.

### Navigation & Feature Tabs

_Located in artifacts/sourdough/app/(tabs)/:_
- `_layout.tsx`: The tab navigator configuration. It defines the bottom tab bar (Feed, Graph, Recipe, Calendar, About) and handles visual effects like the iOS-style blur background.
- `index.tsx` (Feed): The main dashboard for the "Starter" side of the lab. It allows you to start feed sessions, log pH/temperature readings, record peak rise, and sync data across devices.
- `graph.tsx` (Graph): A data visualization hub that renders three key charts:
    - Acidification Index: Tracks bacterial vitality via pH velocity.
    - Lifting Index: Measures yeast capacity and rise time.
    - Metabolic Map: A scatter plot comparing feed ratios against temperature.
- `recipe.tsx` (Recipe): A dual-mode tool for managing bakes:
    - Builder: An editor for creating complex, multi-phase recipes.
    - Runner: An execution interface with live timers, ingredient scaling, and specific logging for phases like "Bulk Fermentation."
- `history.tsx` (Calendar): A chronological view of all past feeds and bakes. It includes a streak tracker, monthly stats, and the ability to export any session as a detailed PDF report.
- `about.tsx` (About): The settings and education hub. It houses unit preferences (F/C), the "Take the Tour" feature, changelogs, and a technical guide for interpreting fermentation data.

### Data Visualization Components

_Located in artifacts/sourdough/components:_
- `PHChart.tsx`: A detailed line chart for tracking pH over time during a single feed session. It features an interactive crosshair for scrubbing data, a temperature overlay, and a "comparison mode" for viewing historical averages.
- `AcidificationChart.tsx`: A longitudinal chart that tracks "pH velocity" (how fast the starter acidifies) across your entire history. This helps bakers visualize their culture's maturation or its response to different flour workloads.
- `LiftingIndexChart.tsx`: A dual-axis chart focused on yeast vitality. It uses bars to show "hours to peak" and triangles to mark "rise percentage." It includes custom hatch patterns to distinguish between standard, sugar-fed, and whole wheat starters.
- `FCSScatterPlot.tsx`: Known as the "Metabolic Map," this scatter plot charts feed ratios against hours-to-peak. It uses a thermal color gradient to show ambient temperature and includes a "Season Compare" mode to overlay data from one year ago.

### User Interaction & Tooling

_Located in artifacts/sourdough/components:_
- `SegmentedNotepad.tsx`: A specialized note editor used in the Bake log. It allows free-form typing while treating "Phase Tags" (e.g., Bulk Fermenting) as atomic tokens that can be inserted as headers.
- `FlourSlider.tsx`: A custom range slider for managing flour blends. It calculates the exact gram weights of All-Purpose vs. Whole Wheat flour in real-time as the user slides.
- `AuthModal.tsx`: The user identity interface where bakers can "Name their data" (First Name + Starter Name). It manages the complex process of linking devices and migrating local data to the cloud.
- `YieldPill.tsx`: A compact UI element used in the Recipe Builder and Runner to display and edit how many loaves a recipe produces.
- `NudgeBanner.tsx`: A floating notification that encourages anonymous users to add a name to their data to ensure it is backed up and accessible on other devices.
- `AffiliateCarousel.tsx`: A rotating gallery of recommended baking gear (jars, scales, etc.) that complies with Amazon Associate disclosure requirements.

### System & Infrastructure

_Located in artifacts/sourdough/components:_
- `ErrorBoundary.tsx` & `ErrorFallback.tsx`: A safety wrapper that prevents the entire app from crashing if a UI component fails. In development, it provides a detailed stack trace; in production, it offers a "Try Again" button.
- `TourSlideshow.tsx & TourStep.tsx`: The infrastructure for the app's guided tour. TourSlideshow handles the full-screen onboarding gallery, while TourStep provides the anchors for highlighting specific UI elements.
- `KeyboardProviderCompat.tsx` & `KeyboardAwareScrollViewCompat.tsx`: Compatibility layers that handle keyboard behavior (avoidance and styling) across iOS, Android, and Web, ensuring the app doesn't crash on platforms where native keyboard controllers are missing.
- `TourProviderWrapper.tsx`: A utility that safely injects the guided tour context only on platforms that support it, preventing bundle errors on the web version.

### Feed Tab Components

_Located in artifacts/sourdough/components/feed:_
These components manage the setup and active tracking of sourdough starter refreshes.
- `FeedSetupView.tsx`: The primary form for starting a new feed. It handles weight inputs for starter, flour, water, and optional sugar, integrates the FlourSlider for custom blends, and allows bakers to snap a "Just Fed" photo.
- `FeedActiveSessionView.tsx`: The dashboard for a feed in progress. It features a large "Time Since Feed" timer, a live PHChart, and controls for logging additional readings or marking the session as "Peaked."
- `PeakWindowAdvisor.tsx`: A predictive tool that helps bakers plan their feeds. Based on history, it calculates the exact weights needed to ensure a starter peaks at a specific target time (e.g., "I need this ready in 6 hours").
- `LevainSlider.tsx`: A specialized hydration slider used within the advisor. It maps "Stiff" to "Slack" consistencies onto precise flour-to-water ratios, respecting biological limits for sourdough cultures.

### Recipe Components

_Located in artifacts/sourdough/components/recipe:_
These components power the two-stage recipe system: creating a spec (Builder) and executing it (Runner).

**Recipe Runner (Active Tracking)**
- `RecipeRunnerActiveView.tsx`: The main interface for an active bake. It displays a progress bar (SegmentBar), manages ingredient scaling, and houses the scrollable list of phase cards.
- `PhaseCard.tsx`: A multi-variant component that adapts based on a phase's status:
    - Pending: Shows a start button and preview.
    - Active: Shows a live timer, interactive checklist, and logging controls.
    - Done: Shows a collapsed summary of logged data.
- `ReadingModal.tsx`: A contextual logging form. It swaps between a generic mode (pH/Temp) and a "Bulk Mode" which includes container volume tracking and sensory observations (e.g., surface bubbles, puffiness).
- `ReadingRow.tsx`: A compact row used inside phase cards to display a single log entry's timestamp and data points.
- `SegmentBar.tsx`: A visual progress strip that sits at the top of the bake tracker, showing which phases are complete, active, or upcoming.
- `PhaseHighlight.tsx`: An animation wrapper that creates a brief "pulse" effect to guide the baker's eye to the next phase after completing the previous one.

**Recipe Builder (Management)**
- `RecipeBuilderListView.tsx`: The library of saved recipes. It features a retro "Keycap" style A–Z index (KeycapKey.tsx) for quick navigation through a large collection.
- `RecipeBuilderEditView.tsx`: The editor for creating or modifying recipes. It allows bakers to add/remove phases and define specific ingredients and instructions for each.
- `ContinuousListInput.tsx`: A "zero-friction" list editor. It behaves like a modern chat app—pressing Enter instantly creates a new line item—enabling bakers to quickly build structured, checkable ingredient lists.
- `PhasePickerModal.tsx`: A categorized menu for selecting which phases to include in a recipe (e.g., Autolyse, Bulk Ferment, Cold Retard).
- `RecipePickerModal.tsx`: A simple selection sheet used to pick a saved recipe before starting the RecipeRunner.

### Constants

_Located in artifacts/sourdough/constants:_
- `theme.ts`: The single source of truth for non-color design tokens. It defines the spacing grid (4px baseline), border radius levels, font families (Serif, Sans, Mono), and a standard typography scale.
- `colors.ts`: Defines the "Artisan Hearth" color palette for both light and dark modes. It uses earthy, natural tones like Soft Flour, Crust Brown, and Baked Earth.
- `TourConfig.ts`: Configures the multi-chapter guided tour. It maps specific UI elements to descriptive text and defines the sequence of steps across all five tabs.
- `TourImages.ts`: An ordered registry of full-screen images used in the onboarding slideshow.
- `aboutContents.ts`: A content repository housing the detailed "Help" documentation, the application changelog, and technical guides for interpreting acidification and lifting data.

### Contexts

_Located in artifacts/sourdough/contexts:_
These providers manage persistent global state and broadcast updates across the app.
- `SyncContext.tsx`: Manages the status of background data synchronization with the cloud. It provides a SyncToast notification to inform users when their data is successfully backed up or if they are currently offline.
- `PreferencesContext.tsx`: Stores user-defined settings such as temperature units (°F/°C), weight units (g/oz), and time formats (12h/24h), persisting them to local storage.
- `FontSizeContext.tsx`: Handles accessibility scaling. It allows users to toggle "Full System Font Size" and applies a custom cap to ensure the UI remains legible at extreme scales.
- `MigrationToastContext.tsx`: Orchestrates the complex UI for migrating local data to a new account. It provides a top-anchored toast that shows progress and success counts (e.g., "Your 12 sessions are now backed up").
- `TourSlideshowContext.tsx`: Controls the visibility of the full-screen onboarding tour. It includes logic to automatically trigger the tour for new installs while skipping it for existing users who have already seen it.
- `TourContext.tsx` & `TourContext.web.tsx`: Compatibility shims for the element-highlighting tour. The web version acts as a safe "no-op" shell to prevent native dependency errors in the browser.

### Custom Hooks

_Located in artifacts/sourdough/hooks:_
- `useColors.ts`: A theme-aware hook that provides the Artisan Hearth color tokens. It automatically switches between light and dark palettes based on the user's system appearance.
- `useActiveBakeTimer.ts`: A real-time engine for the Bake log. It calculates the elapsed time for every in-progress recipe phase and updates every second to drive the live UI timers.
- `useBulkFermentTimer.ts`: A specialized timer for the Bulk Fermentation phase. It handles three states: "None" (waiting for data), "Countdown" (projected time remaining), and "Overtime" (time elapsed since reaching the target rise).

### Data & Infrastructure Libraries

_Located in artifacts/sourdough/lib:_
- `api.ts: The Supabase-backed data layer. It manages the user's stable "Shadow Account" and provides typed methods for listing, upserting, and deleting recipes, feeds, and bake sessions.
- `supabase.ts`: Configures the Supabase client, including auto-refreshing authentication tokens and persistent sessions using AsyncStorage.
- `auth.ts`: Manages the local storage of the user's identity token and profile metadata (First Name, Starter Name).
- `migrate.ts`: Orchestrates the "local-to-cloud" migration process, ensuring that sessions created while offline or before "naming" are safely uploaded to the user's permanent account.
- `recipeStorage.ts`: A persistence wrapper that combines local AsyncStorage (for offline speed) with the remote api.ts (for multi-device sync).
- `deviceId.ts`: Generates and persists a stable, unique identifier for the hardware, allowing the app to track data owners before a user creates an account.

### Analytics & Physics Libraries

_Located in artifacts/sourdough/lib:_
- `analytics.ts`: Houses the logic for computing sourdough vitality. It converts raw pH readings into "Vitality Curves," calculates all-time averages, and derives longitudinal series for the Acidification and Lifting Index charts.
- `predictions.ts`: The "Peak Window Advisor" engine. It uses an exponential model to predict fermentation speed based on inoculation ratio, ambient temperature, and hydration.
- `bulkFermentEngine.ts`: A Proportional-Derivative (PD) engine for tracking dough rise. It blends biological "priors" (typical durations) with empirical data from live readings to project when a dough will be ready for shaping.
- `bulkFermentUtils.ts`: Formatting helpers for the bulk fermentation display, including target volume labels and rise-percentage calculators.
- `feedCoordinate.ts`: Defines the "Feed Coordinate System" (FCS). It buckets feed ratios into macro "Flour Chapters" and micro "Hydration Slices" to organize data on the Metabolic Map.

### Utilities & Tools Libraries

_Located in artifacts/sourdough/lib:_
- `recipeUtils.ts`: A collection of pure formatting functions. It includes the scalePhaseText engine, which uses regex to multiply ingredient quantities (e.g., "500g") while ignoring temperatures and times.
- `recipeHtml.ts`: Pure builders that convert recipes and bake summaries into standalone HTML documents for high-quality printing or sharing as PDFs.
- `recipeMigration.ts`: A tool for "lossless promotion" that upgrades legacy flat-string recipes into the structured, line-item format required by the new checklist system.
- `feedUtils.ts`: General helpers for the feed tab, such as calculating feeding ratios from weights and formatting timer durations.
- `affiliateItems.ts`: Fetches active product recommendations from the remote database to populate the AffiliateCarousel.  
