// Set this to true only when Operation Onboarding is ready for prime time!
export const IS_TOUR_ENABLED = true;

/**
 * GLOBAL STEP ORDERS (Sequential for reliability)
 * 1-5: Feed
 * 6-8: Graph
 * 9-11: Recipe
 * 12-13: History
 * 14-15: About
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

	// SETUP STEPS (Shown only if no active session. Note: the highlight holes will go up to the top of the screen then back down on this tour. Can't be helped.)
    { name: 'track-feed-btn', text: `Start here to monitor a live refresh.`, order: 2 },
    { name: 'plan-feed-btn', text: `Click here to estimate when a refresh will peak, or plan your feed weights to peak at just the right time.`, order: 3 },

    // ACTIVE SESSION STEP (Shown only if active session)
    { name: 'active-timer', text: `This timer tracks exactly how long your starter has been fermenting.`, order: 4 },

    // SHARED STEPS (Shown in both states)
    { name: 'feed-ratios-input', text: `Review or enter your starter, flour, and water weights here, and any sugar used in a sweet starter.`, order: 5 },
    { name: 'live-data-log', text: `A log of your temperature, pH, and rise data during the refresh.`, order: 6 },

    // SETUP STEPS (Shown only if no active session)
	{ name: 'just-fed-photo', text: `Take a picture of your refresh right after feeding to confirm starting height.`, order: 7 },
    { name: 'start-feed-btn', text: `Tap this to begin the refresh timer.`, order: 8 },

	// ACTIVE SESSION STEP (Shown only if active session)
	{ name: 'feed-trends', text: `Elapsed time along the bottom, pH on the left axis, and temperature on the right. A graph of your real-time log.`, order: 9 },
	{ name: 'mark-as-peak', text: `Once your starter reaches its peak, mark the refresh complete to save the data. See your feed results in the next tab and in the Calendar.`, order: 10 },

	// TRANSITION STEP (Shown in both states)
    { name: 'next-chapter-is-graph', text: `Let's see all that data visualized in the Analytics tab.`, order: 11 },
  ],
},
  {
    id: 'graph',
    title: 'Analytics',
    tab: '/graph',
    steps: [
      { name: 'acidification-index', text: 'Monitor your bacterial vitality with the Acidification Index.', order: 9 },
      { name: 'lifting-index', text: 'Track your yeast velocity and rise capacity here.', order: 10 },
      { name: '3rd-graph', text: 'More data analysis coming soon.', order: 11 },
      { name: 'next-chapter-is-recipe', text: 'Plan your next bake in the Recipes tab.', order: 12 },
    ],
  },
  {
    id: 'recipe',
    title: 'Recipes',
    tab: '/recipe',
    steps: [
      { name: 'recipe-builder-toggle', text: 'Find your recipes with alphabetical index cards. Edit existing recipes and add new ones.', order: 13 },
      { name: 'recipe-runner-toggle', text: 'The Recipe Runner guides you through every phase of your bake.', order: 14 },
      { name: 'active-bake', text: 'The Recipe Runner guides you through every phase of your bake.', order: 15 },
      { name: 'next-chapter-is-history', text: 'View your completed bakes (and refreshes) in the Calendar.', order: 16 },
    ],
  },
  {
    id: 'history',
    title: 'Calendar',
    tab: '/history',
    steps: [
      { name: 'name-name-button', text: 'Sync and name your data across devices.', order: 17 },
      { name: 'feed-leaderboard', text: 'Track the number of refreshes, and see your longest daily activity streak.', order: 18 },
      { name: 'calendar', text: 'Tap a date on the calendar to see what you did that day.', order: 19 },
      { name: 'activity-history', text: 'Review, print, and share your bakes (with notes) and refreshes.', order: 20 },
      { name: 'next-chapter-is-about', text: 'Finally, learn more about the app in About.', order: 21 },
    ],
  },
  {
    id: 'about',
    title: 'Settings',
    tab: '/about',
    steps: [
      { name: 'font-setting-toggle', text: 'Toggle advanced accessibility settings here.', order: 22 },
      { name: 'help-section', text: 'Detailed help for every tab in the Bread Lab.', order: 23 },
      { name: 'interpreting-data-section', text: 'A deep dive into how to read your starter and the data you collect from it.', order: 24 },
    ],
  },
];
