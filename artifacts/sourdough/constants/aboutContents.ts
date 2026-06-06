export interface HelpSection {
  heading: string;
  bullets: string[];
}

export interface HelpTab {
  label: string;
  sections: HelpSection[];
}

export const HELP: HelpTab[] = [
{
    label: "Tab 1 — Feed",
    sections: [
      {
        heading: "Feed",
        bullets: [
          "Purpose: Used to track starter refreshes and audit the ongoing health of your sourdough starter. Once completed, each refresh is available for review or printing in the Calendar tab, pictures included.",
          "Feed Amount Inputs: Captures exact input weights in grams for starter inoculation, flour, and water, and provides a feeding ratio.",
          "Enriched Dough Toggle: A specialized sugar switch to log data variations when feeding sweet doughs or specialized cultures.",
          "Flour Blend Sliders: A slider to precisely record custom percentage ratios of All-Purpose (AP) versus Whole Wheat (WW) flours.",
          "Initial Metric Logs: Records baseline numbers, including initial acidity (pH) and starter volume (in mL), right after a fresh mix. Note: the starter volume is compared against the peak volume to give a rise percentage.",
          "Visual Baseline: Includes an integrated camera icon to instantly attach a 'Just Fed' photo, giving you a visual height benchmark to measure against the peak rise.",
          "Start Feed Timer: Starts a timer on the screen showing elapsed time since the most recent refresh.",
        ],
      },
      {
        heading: "Feed — Active Feed",
        bullets: [
          "Active Elapsed Timer: Features a prominent digital stopwatch at the top during active refresh sessions.",
          "Active Metrics: A  '+ Log Reading' button allows you to log pH, temperature, and observations during the refresh. The data points are timestamped to the stopwatch.",
          "Session Termination Target: A 'Mark as Peak' button allows for one final reading, a picture, and peak volume. This saves session data to the Calendar.",
        ],
      },
    ],
  },
  {
    label: "Tab 2 — Graph",
    sections: [
      {
        heading: "Graph",
        bullets: [
          "Purpose: A plot showing your starter's historical acidity curve over time to verify fermentation speeds, allowing you to test variables (e.g, feed ratios, temperatures, flour types, etc.). Note: correlated data is available by reviewing past refreshes in the Calendar tab.",
          "pH Over Time Graph: Traces real-time data points against elapsed hours, visualizing how quickly your culture drops its pH levels.",
          "Data Resolution Axis: Tracks timelines across a horizontal window that scales as time exceeds it, matched against vertical acidity metrics spanning from 5.8 down to 3.2.",
          "Visual Indicators: Maps your current feed points with bright dots, contrasting them against a dashed line that represents your historical Vitality Average (last 5 refreshes).",
          "Timeframe Filtering: Includes an 'All-Time' button toggle to show the all-time average (off by default).",
        ],
      },
    ],
  },
  {
    label: "Tab 3 — Recipe",
    sections: [
      {
        heading: "Recipe",
        bullets: [
          "Purpose: Your master formula library and creation hub.",
          "Empty State: Displays a centralized book icon and a call-to-action to build a recipe when no formulas exist.",
          "Recipe Identity Cards: Summarizes saved formulas into compact cards showing the title, creation date, and phase pills.",
          "Data Portability: Features an integrated export and share control button to easily back up or distribute recipe files.",
        ],
      },
      {
        heading: "Recipe Builder (+ New Recipe)",
        bullets: [
          "Purpose: Initial setup screen for naming and creating a recipe.",
          "Title Input: Provides an open text field to name your recipe before selecting phases (e.g, scald, bulk ferment).",
          "Add Phase: Select from 21 baking-related phases, with the option to add ingredients and instructions in each.",
        ],
      },
      {
        heading: "Recipe Builder — Phase Selection",
        bullets: [
          "Purpose: A comprehensive, categorized list to choose your specific baking steps.",
          "Pre-Processing Category: Setup options like Building the Levain, Scalding, Dry Toasting, and Soaking Seeds/Grains.",
          "Mixing Category: Precise physical choices, contrasting standard Autolysing with Fermentolysing, alongside advanced techniques like Bassinage and Delayed Salt.",
          "Fermentation & Shaping Categories: Post-mix milestones including Stretching and Folding, Laminating, Preshaping, Bench Resting, and Stitching.",
          "Proofing & Baking Categories: Concludes with Cold Retarding, Proofing, Scoring, and Baking.",
        ],
      },
      {
        heading: "Recipe Runner",
        bullets: [
          "Purpose: dashboard for preparing and initiating a live bake session.",
          "Dynamic Checklist: Pulls your master recipe phases into a vertical list with checkboxes.",
          "Flexible Skipping: Lets you uncheck specific phases to dynamically skip them on today's live bake without changing your master template. Confirm the list to begin the bake.",
          "Clean Condensed Rows: Automatically collapses rows with blank ingredient fields to keep your startup screen clear of clutter.",
        ],
      },
      {
        heading: "Recipe Runner — Active Session",
        bullets: [
          "Purpose: The active dashboard used while you are hands-on in the kitchen during a live bake.",
          "Dynamic Scaling Controls: Provides instant global multiplier buttons (0.5× to 3×) that flash a reminder banner to help you scale your ingredient math.",
          "Non-Linear Navigation: Features independent 'Start' buttons next to every step row, allowing you to jump around or execute steps out of order based on how your dough looks. Note: starting a new step pauses the previous one.",
          "Independent Step Timers: Tracks the real-time duration of your active step alongside a global phase counter and a segmented progress bar.",
          "Phase Specs: Per-phase sections that act as read-only instructions from the Recipe Builder for that step.",
        ],
      },
      {
        heading: "Recipe Runner — Journal Overlay",
        bullets: [
          "Purpose: A full-screen scratchpad used to log reflections on how your active baking session went.",
          "Global Logging Canvas: Provides an open text ledger at the top to record variables unique to today's bake.",
          "Tokenized Phase Chips: Allows you to tag comments or reflections to the phase in which you were working when you made the note.",
        ],
      },
    ],
  },
  {
    label: "Tab 4 — Calendar",
    sections: [
      {
        heading: "Calendar",
        bullets: [
          "Purpose: Your high-level monthly log and baking schedule journal.",
          "Activity Metric Badges: Highlights three key statistics at the top: 'This Month' (total entries), 'Day Streak' (consecutive log history), and 'Total Feeds' (lifetime data sum).",
          "Current Date Anchor: Automatically flags the current date with a circular badge to show your place in the month.",
          "Data History Feed: Features a bottom activity ledger that populates with historical notes and logs when you select specific calendar days.",
          "Cloud Synchronization: Displays an automated cloud icon and time stamp verifying successful profile data backups.",
        ],
      },
    ],
  },
  {
    label: "Tab 5 — About",
    sections: [
      {
        heading: "About",
        bullets: [
          "Purpose: Provides app information and customer support access.",
          "Logo: Official branding for Waterview Bakehouse, the maker of this app.",
          "Developer Contact: Email the developer to submit bugs, feature requests, or project feedback.",
          "Documentation: This document.",
          "Changelog: a running list of updates and fixes.",
          "Version: The current app version number and build code.",
        ],
      },
    ],
  },
];

export const CHANGELOG: ChangelogVersion[] = [
  {
      version: "v1.0.10",
      changes: [
        { type: "Changed", content: "Switched to Row-Level Security (RLS) with passwordless anonymous sign-ins, cryptographically locking your data to your identity." },
        { type: "Added", content: "Yield Pill persistence — batch sizes now sync from the Recipe Builder and are preserved in the cloud and Bake History." },
        { type: "Added", content: "Dynamic Scaling Engine — the Recipe Runner now live-scales yield counts and all ingredient measurements based on your selected multiplier (0.5× to 3×)." },
        { type: "Added", content: "Smart Rounding Logic — scaled measurements follow professional baker rules for precision." },
        { type: "Changed", content: "Yield entry UX — the default '1' in the Builder is now a grey breadcrumb placeholder that is overwritten instantly." },
        { type: "Fixed", content: "Resolved a 6000ms timeout crash on Web/Emulator browsers caused by blocking reset dialogs." },
      ],
    },
    {
      version: "v1.0.9",
      changes: [
        { type: "Added", content: "Acidification Index interpretation guide on this screen." },
        { type: "Changed", content: "Acidification Index y-axis now hard-floors at 0 and uses a median-based ceiling." },
        { type: "Added", content: "Outlier pill badges for data points exceeding the computed ceiling." },
      ],
    },
    {
      version: "v1.0.8",
      changes: [
        { type: "Added", content: "°F/°C temperature unit toggle in the Log Reading modal." },
        { type: "Added", content: "Live Vitality Curve — pH chart now includes temperature overlay and fermentation bands." },
        { type: "Added", content: "Temperature zone labels shown in crosshair tooltip." },
        { type: "Added", content: "Analytics charts gain horizontal scrolling after 20 data points." },
        { type: "Changed", content: "Temperature overlay and band colors are theme-aware." },
      ],
    },
    {
      version: "v1.0.6",
      changes: [
        { type: "Added", content: "Graph tab now shows individual session lines for selected tags." },
        { type: "Added", content: "Long-press crosshair on pH chart to scrub and read exact values." },
        { type: "Added", content: "Recipe list A–Z index tabs with vintage keycap design." },
        { type: "Added", content: "Settings section to toggle 'Respect full system font size'." },
      ],
    },
    {
      version: "v1.0.4",
      changes: [
        { type: "Added", content: "Cloud sync via Supabase — data is now backed up and accessible across devices." },
        { type: "Added", content: "Share a completed bake as a PDF directly from the detail card." },
        { type: "Fixed", content: "Resolved calendar sync and recipe restoration bugs." },
      ],
    },
    {
      version: "v1.0.1",
      changes: [
        { type: "Removed", content: "pH over-time chart from the Active Feed view and Help reference." },
      ],
    },
];

// ── constants/aboutContent.ts ──

export const ACIDIFICATION_DATA = {
  title: "Acidification Index",
  body: "Each data point is your starter's average pH drop per hour for that feed session. For a standard flour-and-water or whole wheat starter, a flattening or downward trend over time indicates a maturing, well-balanced culture — the bacteria have settled into a stable rhythm. For a sweet starter, an upward trend is the healthy signal: your culture is overcoming sugar pressure and acidifying more aggressively with each feed.",
  sections: [
    {
      heading: "The Sweet Spot (Low & Stable)",
      visual: "A tight, flat line right above zero (0.05-0.15 ΔpH/hr).",
      diagnosticStandard: "A mellow yeast-leaning culture with minimal bacterial activity.",
      diagnosticSweet: "With a low hydration, this is perfect for a pasta madre style dough.",
      italicLabel: "pasta madre",
      insight: "If kept in an 80°F environment, you have a low-acid runway for the yeast to build lifting power.",
      status: "Ready for enriched bakes."
    },
    {
      heading: "The Awakening (Low & Increasing)",
      visual: "The graph line starts near zero and steps steadily upward over 3–4 consecutive feeds.",
      diagnosticStandard: "The culture is waking up from refrigeration or recovering from neglect. Biomass is expanding exponentially.",
      diagnosticSweet: "The yeast and bacteria are successfully neutralizing the high osmotic pressure of the sugar and are learning how to ferment well in a low-moisture environment.",
      insight: "Your culture is actively building metabolic velocity and adapting to its environment. If this is a sweet starter, it confirms the cells are successfully overcoming sugar pressure.",
      status: "Hold. Wait for the velocity to flatten before baking."
    },
    {
      heading: "The Acid Tank (High & Stable)",
      visual: "The line plateaus aggressively high on the Y-axis (well above 0.35 ΔpH/hr), refusing to drop from feed to feed.",
      diagnosticStandard: "Hyper-acidic runaway. The bacteria are completely outrunning the yeast, dropping the pH into the high 3s almost immediately. This creates an extreme risk of proteolysis (gluten-melt).",
      diagnosticSweet: "Severe acid shock. The yeast is completely paralyzed by sugar pressure, stretching the hours-to-peak denominator out, while high-stress bacteria panic-produce acid.",
      insight: "Acidification velocity is dangerously high, meaning bacteria are outrunning your yeast. This risks degrading your dough's gluten structure, leading to a sticky, unmanageable mix.",
      status: "Do Not Bake. Dilute immediately with a high-ratio refresh (e.g. 1:2:2 or 1:3:3) to reset the baseline."
    },
    {
      heading: "The Compression Slide (High & Decreasing)",
      visual: "The line starts at a high peak and slopes downward over several consecutive feeds.",
      diagnosticStandard: "Systemic exhaustion or product inhibition. The starter has accumulated so much residual acid that it is beginning to inhibit its own bacteria. This indicates acid accumulation slowing the bacteria; advise diluting the acid pool with a large refresh.",
      diagnosticSweet: "The yeast population has adapted to the sugar and is exploding. Because the yeast is crushing the timeline and driving down the \"hours to peak\" window, it compresses the hours. This is an excellent sign that surging yeast speed is compressing the fermentation window.",
      insight: "Acid velocity is tapering down.",
      status: "Balanced and ready if yeast capacity is high."
    }
  ]
};

export const LIFTING_DATA = {
  title: "Lifting Index",
  body: "Bars show how many hours it took your starter to reach peak volume; open triangles show how much it expanded at peak (rise %). Bar fill varies by starter type: solid for standard, diagonal hatch for sweet, cross-hatch for whole wheat.\n\nThe two axes are locked to a shared metabolic baseline: 4 hours to peak and 100% expansion always sit at the same vertical position. Both axes scale up together when either value exceeds that target. The spatial relationship between the top of a bar and its triangle is directly diagnostic. Check the baker's notes for any session to see the context recorded at the time.",
  sections: [
    {
      heading: "The Golden Gap",
      visual: "A short bar with a triangle floating well above it.",
      diagnostic: "High metabolic efficiency — the yeast achieves maximum volumetric output in minimum time.",
      insight: "The wild yeast population is dense, stress-tolerant, and actively outrunning gluten degradation. This starter will yield a light, airy crumb and an explosive oven spring. Check the baker's notes for this session — a recent flour switch, a pinch of rye, or an especially warm proof will often explain the surge."
    },
    {
      heading: "The Parallel Alignment",
      visual: "The triangle and the top of the bar sit at roughly the same height, in the upper or middle section of the chart.",
      diagnostic: "Balanced vitality — the culture is hitting its exact baseline targets and is highly predictable.",
      insight: "The yeast is working at a steady pace that perfectly matches the structural strength of the flour. This is the green light for standard dough scheduling. Check the baker's notes for this session to confirm the schedule and temperature matched what you were targeting."
    },
    {
      heading: "The Stretched Gap",
      visual: "A very tall bar with a triangle sitting close to — but still above — the bar top.",
      diagnostic: "Sluggish endurance — the yeast has gas capacity but its metabolic rate is slow.",
      insight: "The yeast population is viable but likely sparse or cold-dormant. If used in a final dough now, bulk fermentation will drag on for hours, risking over-acidification before the dough doubles. Check the baker's notes for this session — a cold kitchen overnight or a reduced feed ratio are the most common culprits."
    },
    {
      heading: "The Compressed Deficit",
      visual: "A tall bar with the triangle buried beneath the bar top.",
      diagnostic: "A structural or metabolic wall — the yeast took a long time and still achieved very little lift.",
      insight: "Severe stress — either osmotic shock (too much sugar paralyzing the yeast cells) or proteolysis (acid produced so fast, or the starter sat so long that the gluten network liquefied and dropped the gas before momentum built). Check the baker's notes for this session; a higher sugar ratio, a missed feed, or an unusually long ferment will point to the cause."
    },
    {
      heading: "If You See This: The Truncated Session",
      visual: "Both the bar and the triangle are low on the chart.",
      diagnostic: "Likely premature termination — the session ended before the starter reached true peak capacity.",
      insight: "The record was probably closed out early rather than at a natural stopping point. Check the baker's notes for this session — you may have logged a reason at the time."
    }
  ]
};