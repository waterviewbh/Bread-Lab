// Set this to true only when Operation Onboarding is ready for prime time!
export const IS_TOUR_ENABLED = true;

/**
 * GLOBAL STEP ORDERS (Sequential for reliability)
 * 1-9: Feed
 * 11-13: Graph
 * 15: Recipe
 * 17-20: History
 * 22-24: About
 */

export interface TourStep {
  name: string;
  text: string;
  order: number;
}

export interface TourChapter {
  id: string;
  title: string;
  tab: string;
  steps: TourStep[];
}

export const TOUR_CHAPTERS: TourChapter[] = [
// TourConfig.ts
{
  id: 'feed',
  title: 'Feed Tab',
  tab: '/',
  steps: [

	// BEGINNING STEP (Shown in both states)
	{ name: 'app-name', text: `Welcome to the Bread Lab! This app helps turn bakers into scientists, and back again. Start here by logging your starter's feeds.`, order: 1 },

	// SETUP STEPS (Shown only if no active session. Note: the highlight holes will go up to the top of the screen then back down on this tour.)
    { name: 'feed-pages', text: `Track live refreshes or calculate weights to time a peak.`, order: 2 },

    // ACTIVE SESSION STEP (Shown only if active session)
    { name: 'active-timer', text: `Track how long your starter has been fermenting.`, order: 3 },

    // SHARED STEPS (Shown in both states)
    { name: 'feed-ratios-input', text: `Enter your starter, flour, water, and sugar weights here.`, order: 4 },
    { name: 'live-data-log', text: `Log your temperature, pH, and volume data during a refresh.`, order: 5 },

    // SETUP STEPS (Shown only if no active session)
	{ name: 'just-fed-photo', text: `Take a photo right after feeding to confirm starting height.`, order: 6 },
    { name: 'start-feed-btn', text: `Tap to start the refresh timer.`, order: 7 },

	// ACTIVE SESSION STEP (Shown only if active session)
	{ name: 'feed-trends', text: `Real-time graph tracks elapsed time, pH, and temperature.`, order: 8 },
	{ name: 'mark-as-peak', text: `Mark a peak to save data and view results in the Graph and Calendar tabs.`, order: 9 },

	// TRANSITION STEP (Shown in both states)
    { name: 'next-chapter-is-graph', text: `Let's view your data visualized in the Graph tab.`, order: 10 },
  ],
},
  {
    id: 'graph',
    title: 'Analytics',
    tab: '/graph',
    steps: [
      { name: 'acidification-index', text: 'Monitor your bacterial vitality with the Acidification Index.', order: 11 },
      { name: 'lifting-index',       text: 'Track your yeast velocity and rise capacity here.',             order: 12 },
      { name: 'fcs-scatter',         text: 'See how your feeding ratios and ambient temperature shape starter performance.', order: 13 },
      { name: 'next-chapter-is-recipe', text: 'Plan your next bake in the Recipes tab.',                   order: 14 },
    ],
  },
  {
    id: 'recipe',
    title: 'Recipes',
    tab: '/recipe',
    steps: [
      { name: 'recipe-pages',  text: 'Recipe Builder stores your formulas. Recipe Runner guides you through an active bake.', order: 15 },
      { name: 'next-chapter-is-history', text: 'View your completed bakes (and refreshes) in the Calendar.',                            order: 16 },
    ],
  },
  {
    id: 'history',
    title: 'Calendar',
    tab: '/history',
    steps: [
      { name: 'name-name-button',      text: 'Sync and name your data across devices.',                               order: 17 },
      { name: 'feed-leaderboard',      text: 'Track the number of refreshes, and see your longest daily activity streak.', order: 18 },
      { name: 'calendar',              text: 'Tap a date on the calendar to see what you did that day.',               order: 19 },
      { name: 'activity-history',      text: 'Review, print, and share your bakes (with notes) and refreshes.',        order: 20 },
      { name: 'next-chapter-is-about', text: 'Finally, learn more about the app in About.',                           order: 21 },
    ],
  },
  {
    id: 'about',
    title: 'Settings',
    tab: '/about',
    steps: [
      { name: 'font-setting-toggle',        text: 'Toggle advanced accessibility settings here.',           order: 22 },
      { name: 'help-section',               text: 'Detailed help for every tab in the Bread Lab.',          order: 23 },
      { name: 'interpreting-data-section',  text: 'A deep dive into reading your starter based on the data you collect.', order: 24 },
    ],
  },
];

// Flat lookup: step name → text. Used by TourStep to avoid duplicating text in JSX.
export const TOUR_STEP_TEXT: Record<string, string> = Object.fromEntries(
  TOUR_CHAPTERS.flatMap((ch) => ch.steps.map((s) => [s.name, s.text]))
);
