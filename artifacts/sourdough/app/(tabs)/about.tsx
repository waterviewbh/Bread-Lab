import {
  Image,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";
import { useState } from "react";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useFontSize } from "@/contexts/FontSizeContext";
import appConfig from "../../app.json";

const WEB_TOP = Platform.OS === "web" ? 67 : 0;
const TAB_BAR_PAD = Platform.OS === "web" ? 84 : 49;

const logo = require("@/assets/images/waterview-bakehouse-logo.jpg");

// ── Help content ──────────────────────────────────────────────────────────────

interface HelpSection {
  heading: string;
  bullets: string[];
}

interface HelpTab {
  label: string;
  sections: HelpSection[];
}

const HELP: HelpTab[] = [
  {
    label: "Tab 1 — Feed",
    sections: [
      {
        heading: "Feed",
        bullets: [
          "Purpose: Used to track starter refreshes and audit the ongoing health of your sourdough starter. Once comppleted, each refresh is available for review or printing in the Calendar tab, pictures included.",
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
          "Changelong: a running list of updates and fixes.",
          "Version: The current app version number and build code.",
        ],
      },
    ],
  },
];

// ── Collapsible help section ──────────────────────────────────────────────────

function HelpAccordion({ tab, colors }: { tab: HelpTab; colors: ReturnType<typeof useColors> }) {
  const [open, setOpen] = useState(false);

  return (
    <View style={[styles.accordionCard, { borderColor: colors.border, backgroundColor: colors.card }]}>
      {/* Header row — toggles open/closed */}
      <Pressable
        onPress={() => setOpen((v) => !v)}
        style={({ pressed }) => [styles.accordionHeader, pressed && { opacity: 0.7 }]}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
      >
        <Text style={[styles.accordionTitle, { color: colors.foreground }]}>{tab.label}</Text>
        <Feather
          name={open ? "chevron-up" : "chevron-down"}
          size={16}
          color={colors.mutedForeground}
        />
      </Pressable>

      {/* Expanded content */}
      {open && (
        <View style={[styles.accordionBody, { borderTopColor: colors.border }]}>
          {tab.sections.map((sec, si) => (
            <View key={si} style={si > 0 ? styles.subSectionGap : undefined}>
              {/* Sub-section heading */}
              <Text style={[styles.subHeading, { color: colors.mutedForeground }]}>
                {sec.heading.toUpperCase()}
              </Text>

              {/* Bullet list */}
              {sec.bullets.map((bullet, bi) => {
                // Split "Label: body" so the label renders bold
                const colonIdx = bullet.indexOf(": ");
                const hasLabel = colonIdx > 0 && colonIdx < 40;
                const label = hasLabel ? bullet.slice(0, colonIdx) : null;
                const body = hasLabel ? bullet.slice(colonIdx + 2) : bullet;

                return (
                  <View key={bi} style={styles.bulletRow}>
                    <View style={[styles.bulletDot, { backgroundColor: colors.mutedForeground }]} />
                    <Text style={[styles.bulletText, { color: colors.foreground }]}>
                      {label ? (
                        <>
                          <Text style={styles.bulletLabel}>{label}:</Text>
                          {" "}{body}
                        </>
                      ) : body}
                    </Text>
                  </View>
                );
              })}
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

// ── Screen ───────────────────────────────────────────────────────────────────

export default function AboutScreen() {
  const colors = useColors();
  const { fullFontSize, setFullFontSize } = useFontSize();

  const handleEmail = () => {
    Linking.openURL("mailto:waterviewbakehouse@gmail.com");
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={[
        styles.container,
        { paddingTop: WEB_TOP + 32, paddingBottom: TAB_BAR_PAD + 56 },
      ]}
      showsVerticalScrollIndicator={false}
    >
      {/* ── Logo ── */}
      <View style={styles.logoWrap}>
        <Image
          source={logo}
          style={styles.logo}
          resizeMode="contain"
          accessibilityLabel="Waterview Bakehouse logo"
        />
      </View>

      {/* ── Settings ── */}
      <Text style={[styles.sectionLabel, { color: colors.mutedForeground, borderBottomColor: colors.border }]}>
        Settings
      </Text>

      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={styles.settingRow}>
          <View style={styles.settingText}>
            <Text style={[styles.settingTitle, { color: colors.foreground }]}>
              Respect full system font size
            </Text>
            <Text style={[styles.settingDescription, { color: colors.mutedForeground }]}>
              Allows the app to scale text beyond the default cap for improved accessibility.
            </Text>
          </View>
          <Switch
            value={fullFontSize}
            onValueChange={setFullFontSize}
            trackColor={{ false: colors.muted, true: colors.primary }}
            thumbColor={colors.primaryForeground}
            accessibilityLabel="Respect full system font size"
            accessibilityRole="switch"
            accessibilityState={{ checked: fullFontSize }}
          />
        </View>
      </View>

      {/* ── Contact ── */}
      <Text style={[styles.sectionLabel, { color: colors.mutedForeground, borderBottomColor: colors.border }]}>
        Contact
      </Text>

      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Pressable
          onPress={handleEmail}
          style={({ pressed }) => [styles.contactRow, pressed && { opacity: 0.6 }]}
          accessibilityLabel="Send email to Waterview Bakehouse"
          accessibilityRole="link"
        >
          <Feather name="mail" size={18} color={colors.primary} style={styles.contactIcon} />
          <Text style={[styles.contactText, { color: colors.primary }]}>
            waterviewbakehouse@gmail.com
          </Text>
        </Pressable>
      </View>

      {/* ── Help ── */}
      <Text style={[styles.sectionLabel, { color: colors.mutedForeground, borderBottomColor: colors.border }]}>
        Help
      </Text>

      {HELP.map((tab, i) => (
        <HelpAccordion key={i} tab={tab} colors={colors} />
      ))}

      {/* ── Interpreting Your Data ── */}
      <Text
        style={[
          styles.sectionLabel,
          { color: colors.mutedForeground, borderBottomColor: colors.border, marginTop: 28 },
        ]}
      >
        Interpreting Your Data
      </Text>

      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={[styles.interpretEntry, { borderBottomColor: colors.border }]}>
          <Text style={[styles.interpretHeading, { color: colors.foreground }]}>
            Acidification Index
          </Text>
          <Text style={[styles.interpretBody, { color: colors.foreground }]}>
            Each data point is your starter's average pH drop per hour for that feed session. For a standard
            flour-and-water or whole wheat starter, a flattening or downward trend over time indicates a
            maturing, well-balanced culture — the bacteria have settled into a stable rhythm. For a sweet
            starter, an upward trend is the healthy signal: your culture is overcoming sugar pressure and
            acidifying more aggressively with each feed.
          </Text>
          <Text style={[styles.interpretBody, { color: colors.foreground, fontFamily: "Inter_600SemiBold", marginTop: 14 }]}>
            The Sweet Spot (Low &amp; Stable)
          </Text>
          <Text style={[styles.interpretBody, { color: colors.foreground }]}>
            <Text style={{ fontFamily: "Inter_600SemiBold" }}>Visual: </Text>
            {"A tight, flat line right above zero (0.05\u20130.15 \u0394pH/hr).\n"}
            <Text style={{ fontFamily: "Inter_600SemiBold" }}>Diagnostic [Standard]: </Text>
            {"A mellow yeast-leaning culture with minimal bacterial activity. "}
            <Text style={{ fontFamily: "Inter_600SemiBold" }}>[Sweet]: </Text>
            {"With a low hydration, this is perfect for a pasta madre style dough.\n"}
            <Text style={{ fontFamily: "Inter_600SemiBold" }}>Baker's Insight: </Text>
            {"If kept in an 80\u00a0\u00b0F environment, you have a low-acid runway for the yeast to build lifting power.\n"}
            <Text style={{ fontFamily: "Inter_600SemiBold" }}>Status: </Text>
            Ready for enriched bakes.
          </Text>

          <Text style={[styles.interpretBody, { color: colors.foreground, fontFamily: "Inter_600SemiBold", marginTop: 14 }]}>
            The Awakening (Low &amp; Increasing)
          </Text>
          <Text style={[styles.interpretBody, { color: colors.foreground }]}>
            <Text style={{ fontFamily: "Inter_600SemiBold" }}>Visual: </Text>
            {"The graph line starts near zero and steps steadily upward over 3\u20134 consecutive feeds.\n"}
            <Text style={{ fontFamily: "Inter_600SemiBold" }}>Diagnostic [Standard]: </Text>
            {"The culture is waking up from refrigeration or recovering from neglect. Biomass is expanding exponentially. "}
            <Text style={{ fontFamily: "Inter_600SemiBold" }}>[Sweet]: </Text>
            {"The yeast and bacteria are successfully neutralizing the high osmotic pressure of the sugar and are learning how to ferment well in a low-moisture environment.\n"}
            <Text style={{ fontFamily: "Inter_600SemiBold" }}>Baker's Insight: </Text>
            {"Your culture is actively building metabolic velocity and adapting to its environment. If this is a sweet starter, it confirms the cells are successfully overcoming sugar pressure.\n"}
            <Text style={{ fontFamily: "Inter_600SemiBold" }}>Status: </Text>
            Hold. Wait for the velocity to flatten before baking.
          </Text>

          <Text style={[styles.interpretBody, { color: colors.foreground, fontFamily: "Inter_600SemiBold", marginTop: 14 }]}>
            The Acid Tank (High &amp; Stable)
          </Text>
          <Text style={[styles.interpretBody, { color: colors.foreground }]}>
            <Text style={{ fontFamily: "Inter_600SemiBold" }}>Visual: </Text>
            {"The line plateaus aggressively high on the Y-axis (well above 0.35 \u0394pH/hr), refusing to drop from feed to feed.\n"}
            <Text style={{ fontFamily: "Inter_600SemiBold" }}>Diagnostic [Standard]: </Text>
            {"Hyper-acidic runaway. The bacteria are completely outrunning the yeast, dropping the pH into the high 3s almost immediately. This creates an extreme risk of proteolysis (gluten-melt).\n"}
            <Text style={{ fontFamily: "Inter_600SemiBold" }}>[Sweet]: </Text>
            {"Severe acid shock. The yeast is completely paralyzed by sugar pressure, stretching the hours-to-peak denominator out, while high-stress bacteria panic-produce acid.\n"}
            <Text style={{ fontFamily: "Inter_600SemiBold" }}>Baker's Insight: </Text>
            {"Acidification velocity is dangerously high, meaning bacteria are outrunning your yeast. This risks degrading your dough's gluten structure, leading to a sticky, unmanageable mix.\n"}
            <Text style={{ fontFamily: "Inter_600SemiBold" }}>Status: </Text>
            {"Do Not Bake. Dilute immediately with a high-ratio refresh (e.g.\u00a01:2:2 or 1:3:3) to reset the baseline."}
          </Text>

          <Text style={[styles.interpretBody, { color: colors.foreground, fontFamily: "Inter_600SemiBold", marginTop: 14 }]}>
            The Compression Slide (High &amp; Decreasing)
          </Text>
          <Text style={[styles.interpretBody, { color: colors.foreground }]}>
            <Text style={{ fontFamily: "Inter_600SemiBold" }}>Visual: </Text>
            {"The line starts at a high peak and slopes downward over several consecutive feeds.\n"}
            <Text style={{ fontFamily: "Inter_600SemiBold" }}>Diagnostic [Standard]: </Text>
            {"Systemic exhaustion or product inhibition. The starter has accumulated so much residual acid that it is beginning to inhibit its own bacteria. "}
            <Text style={{ fontFamily: "Inter_600SemiBold" }}>[Sweet]: </Text>
            {"The yeast population has adapted to the sugar and is exploding. Because the yeast is crushing the timeline and driving down the \u201Chours to peak\u201D window, it compresses the h[...]
            <Text style={{ fontFamily: "Inter_600SemiBold" }}>Baker's Insight: </Text>
            {"Acid velocity is tapering down. "}
            <Text style={{ fontFamily: "Inter_600SemiBold" }}>[Standard] </Text>
            {"This indicates acid accumulation slowing the bacteria \u2014 dilute the acid pool with a large refresh. "}
            <Text style={{ fontFamily: "Inter_600SemiBold" }}>[Sweet] </Text>
            {"This is an excellent sign that surging yeast speed is compressing the fermentation window.\n"}
            <Text style={{ fontFamily: "Inter_600SemiBold" }}>Status: </Text>
            Balanced and ready if yeast capacity is high.
          </Text>
        </View>
        <View style={styles.interpretEntry}>
          <Text style={[styles.interpretHeading, { color: colors.foreground }]}>
            Lifting Index
          </Text>
          <Text style={[styles.interpretBody, { color: colors.foreground }]}>
            Bars show how many hours it took your starter to reach peak volume; open triangles show how much it expanded at peak (rise %). Bar fill varies by starter type: solid for standard, dia[...]
          </Text>
          <Text style={[styles.interpretBody, { color: colors.foreground, marginTop: 6 }]}>
            The two axes are locked to a shared metabolic baseline: 4 hours to peak and 100% expansion always sit at the same vertical position. Both axes scale up together when either value exce[...]
          </Text>

          <Text style={[styles.interpretBody, { color: colors.foreground, fontFamily: "Inter_600SemiBold", marginTop: 14 }]}>
            The Golden Gap
          </Text>
          <Text style={[styles.interpretBody, { color: colors.foreground }]}>
            <Text style={{ fontFamily: "Inter_600SemiBold" }}>Visual: </Text>
            {"A short bar with a triangle floating well above it.\n"}
            <Text style={{ fontFamily: "Inter_600SemiBold" }}>Diagnostic: </Text>
            {"High metabolic efficiency — the yeast achieves maximum volumetric output in minimum time.\n"}
            <Text style={{ fontFamily: "Inter_600SemiBold" }}>Baker's Insight: </Text>
            {"The wild yeast population is dense, stress-tolerant, and actively outrunning gluten degradation. This starter will yield a light, airy crumb and an explosive oven spring.\n"}
            Check the baker's notes for this session — a recent flour switch, a pinch of rye, or an especially warm proof will often explain the surge.
          </Text>

          <Text style={[styles.interpretBody, { color: colors.foreground, fontFamily: "Inter_600SemiBold", marginTop: 14 }]}>
            The Parallel Alignment
          </Text>
          <Text style={[styles.interpretBody, { color: colors.foreground }]}>
            <Text style={{ fontFamily: "Inter_600SemiBold" }}>Visual: </Text>
            {"The triangle and the top of the bar sit at roughly the same height, in the upper or middle section of the chart.\n"}
            <Text style={{ fontFamily: "Inter_600SemiBold" }}>Diagnostic: </Text>
            {"Balanced vitality — the culture is hitting its exact baseline targets and is highly predictable.\n"}
            <Text style={{ fontFamily: "Inter_600SemiBold" }}>Baker's Insight: </Text>
            {"The yeast is working at a steady pace that perfectly matches the structural strength of the flour. This is the green light for standard dough scheduling.\n"}
            Check the baker's notes for this session to confirm the schedule and temperature matched what you were targeting.
          </Text>

          <Text style={[styles.interpretBody, { color: colors.foreground, fontFamily: "Inter_600SemiBold", marginTop: 14 }]}>
            The Stretched Gap
          </Text>
          <Text style={[styles.interpretBody, { color: colors.foreground }]}>
            <Text style={{ fontFamily: "Inter_600SemiBold" }}>Visual: </Text>
            {"A very tall bar with a triangle sitting close to — but still above — the bar top.\n"}
            <Text style={{ fontFamily: "Inter_600SemiBold" }}>Diagnostic: </Text>
            {"Sluggish endurance — the yeast has gas capacity but its metabolic rate is slow.\n"}
            <Text style={{ fontFamily: "Inter_600SemiBold" }}>Baker's Insight: </Text>
            {"The yeast population is viable but likely sparse or cold-dormant. If used in a final dough now, bulk fermentation will drag on for hours, risking over-acidification before the dough[...]
            Check the baker's notes for this session — a cold kitchen overnight or a reduced feed ratio are the most common culprits.
          </Text>

          <Text style={[styles.interpretBody, { color: colors.foreground, fontFamily: "Inter_600SemiBold", marginTop: 14 }]}>
            The Compressed Deficit
          </Text>
          <Text style={[styles.interpretBody, { color: colors.foreground }]}>
            <Text style={{ fontFamily: "Inter_600SemiBold" }}>Visual: </Text>
            {"A tall bar with the triangle buried beneath the bar top.\n"}
            <Text style={{ fontFamily: "Inter_600SemiBold" }}>Diagnostic: </Text>
            {"A structural or metabolic wall — the yeast took a long time and still achieved very little lift.\n"}
            <Text style={{ fontFamily: "Inter_600SemiBold" }}>Baker's Insight: </Text>
            {"Severe stress — either osmotic shock (too much sugar paralyzing the yeast cells) or proteolysis (acid produced so fast, or the starter sat so long, that the gluten network liquefi[...]
            Check the baker's notes for this session; a higher sugar ratio, a missed feed, or an unusually long ferment will point to the cause.
          </Text>

          <Text style={[styles.interpretBody, { color: colors.mutedForeground, fontFamily: "Inter_600SemiBold", marginTop: 14 }]}>
            If You See This: The Truncated Session
          </Text>
          <Text style={[styles.interpretBody, { color: colors.foreground }]}>
            <Text style={{ fontFamily: "Inter_600SemiBold" }}>Visual: </Text>
            {"Both the bar and the triangle are low on the chart.\n"}
            <Text style={{ fontFamily: "Inter_600SemiBold" }}>Diagnostic: </Text>
            {"Likely premature termination — the session ended before the starter reached true peak capacity.\n"}
            <Text style={{ fontFamily: "Inter_600SemiBold" }}>Baker's Insight: </Text>
            {"The record was probably closed out early rather than at a natural stopping point.\n"}
            Check the baker's notes for this session — you may have logged a reason at the time.
          </Text>
        </View>
      </View>

      {/* ── Changelog ── */}

      <Text style={[styles.sectionLabel, { color: colors.mutedForeground, borderBottomColor: colors.border, marginTop: 28 }]}>
        Changelog
      </Text>

      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>

        <View style={[styles.changelogEntry, { borderBottomColor: colors.border }]}>
          <Text style={[styles.changelogVersion, { color: colors.foreground }]}>v1.0.9</Text>
          <Text style={[styles.changelogBullet, { color: colors.foreground }]}>
            <Text style={styles.changelogLabel}>Added:</Text>
            {" "}Acidification Index interpretation guide on this screen — four diagnostic patterns (The Sweet Spot, The Awakening, The Acid Tank, The Compression Slide) with standard and sweet[...]
          </Text>
          <Text style={[styles.changelogBullet, { color: colors.foreground, marginTop: 6 }]}>
            <Text style={styles.changelogLabel}>Changed:</Text>
            {" "}Acidification Index y-axis now hard-floors at 0 and uses a median-based ceiling (3× median) so a single outlier spike no longer squashes all other data.
          </Text>
          <Text style={[styles.changelogBullet, { color: colors.foreground, marginTop: 6 }]}>
            <Text style={styles.changelogLabel}>Added:</Text>
            {" "}Outlier pill badges: when a data point exceeds the computed ceiling, the line clips at the top and a badge shows the exact value (e.g.\u00a06.65) aligned to that feed's x-positio[...]
          </Text>
        </View>

        <View style={[styles.changelogEntry, { borderBottomColor: colors.border }]}>
          <Text style={[styles.changelogVersion, { color: colors.foreground }]}>v1.0.8</Text>
          <Text style={[styles.changelogBullet, { color: colors.foreground }]}>
            <Text style={styles.changelogLabel}>Added:</Text>
            {" "}°F/°C temperature unit toggle in the Log Reading modal; unit is saved with each reading and shown on reading cards.
          </Text>
          <Text style={[styles.changelogBullet, { color: colors.foreground, marginTop: 6 }]}>
            <Text style={styles.changelogLabel}>Added:</Text>
            {" "}Live Vitality Curve — the Feed tab pH chart now includes a right y-axis temperature overlay, three fermentation temperature bands (Warm / Balanced / Cool), and dumbbell markers[...]
          </Text>
          <Text style={[styles.changelogBullet, { color: colors.foreground, marginTop: 6 }]}>
            <Text style={styles.changelogLabel}>Added:</Text>
            {" "}Temperature zone label ("Warm", "Balanced", "Cool") shown in the crosshair tooltip alongside the interpolated °F/°C reading.
          </Text>
          <Text style={[styles.changelogBullet, { color: colors.foreground, marginTop: 6 }]}>
            <Text style={styles.changelogLabel}>Added:</Text>
            {" "}Analytics charts (Acidification Index & Lifting Index) gain horizontal scrolling once there are more than 20 data points; view defaults to the most recent bakes on load.
          </Text>
          <Text style={[styles.changelogBullet, { color: colors.foreground, marginTop: 6 }]}>
            <Text style={styles.changelogLabel}>Changed:</Text>
            {" "}Temperature overlay and band colors are theme-aware — distinct values for light and dark mode.
          </Text>
          <Text style={[styles.changelogBullet, { color: colors.foreground, marginTop: 6 }]}>
            <Text style={styles.changelogLabel}>Changed:</Text>
            {" "}Vitality avg ghost line and All-time toggle removed from the Live Vitality Curve to reduce chart clutter.
          </Text>
        </View>

        <View style={[styles.changelogEntry, { borderBottomColor: colors.border }]}>
          <Text style={[styles.changelogVersion, { color: colors.foreground }]}>v1.0.6</Text>
          <Text style={[styles.changelogBullet, { color: colors.foreground }]}>
            <Text style={styles.changelogLabel}>Added:</Text>
            {" "}Graph tab now shows individual session lines for the selected tag (Sugar or WW Blend) alongside the all-time average as a reference — makes it easy to see how each variable com[...]
          </Text>
          <Text style={[styles.changelogBullet, { color: colors.foreground, marginTop: 6 }]}>
            <Text style={styles.changelogLabel}>Added:</Text>
            {" "}Long-press anywhere on the pH chart to activate a crosshair — drag to scrub and read the exact pH and time at any point.
          </Text>
          <Text style={[styles.changelogBullet, { color: colors.foreground, marginTop: 6 }]}>
            <Text style={styles.changelogLabel}>Added:</Text>
            {" "}Graph and Calendar filter chip selections are now remembered between sessions.
          </Text>
          <Text style={[styles.changelogBullet, { color: colors.foreground, marginTop: 6 }]}>
            <Text style={styles.changelogLabel}>Added:</Text>
            {" "}Recipe list A–Z index tabs — tap a letter to jump to recipes starting with that letter. The tabs use a vintage keycap design with two rows (A–M on top, N–Z below) that ov[...]
          </Text>
          <Text style={[styles.changelogBullet, { color: colors.foreground, marginTop: 6 }]}>
            <Text style={styles.changelogLabel}>Added:</Text>
            {" "}Settings section in this About screen — toggle "Respect full system font size" to let your device's accessibility font size apply throughout the app.
          </Text>
          <Text style={[styles.changelogBullet, { color: colors.foreground, marginTop: 6 }]}>
            <Text style={styles.changelogLabel}>Changed:</Text>
            {" "}"Toasting the Flour" phase renamed to "Dry Toasting".
          </Text>
          <Text style={[styles.changelogBullet, { color: colors.foreground, marginTop: 6 }]}>
            <Text style={styles.changelogLabel}>Changed:</Text>
            {" "}"This isn't me" button in the account sheet renamed to "Track different starter".
          </Text>
        </View>

        <View style={[styles.changelogEntry, { borderBottomColor: colors.border }]}>
          <Text style={[styles.changelogVersion, { color: colors.foreground }]}>v1.0.4</Text>
          <Text style={[styles.changelogBullet, { color: colors.foreground }]}>
            <Text style={styles.changelogLabel}>Added:</Text>
            {" "}Cloud sync via Supabase — feed sessions, bake history, and recipes are now backed up and accessible across devices. Sign in with your name and starter name under Calendar → a[...]
          </Text>
          <Text style={[styles.changelogBullet, { color: colors.foreground, marginTop: 6 }]}>
            <Text style={styles.changelogLabel}>Added:</Text>
            {" "}Recipe ingredients and instructions are now saved with each completed bake, so the full phase details appear in history even after a recipe is edited or deleted.
          </Text>
          <Text style={[styles.changelogBullet, { color: colors.foreground, marginTop: 6 }]}>
            <Text style={styles.changelogLabel}>Added:</Text>
            {" "}Share a completed bake as a PDF directly from the bake detail card in Calendar.
          </Text>
          <Text style={[styles.changelogBullet, { color: colors.foreground, marginTop: 6 }]}>
            <Text style={styles.changelogLabel}>Added:</Text>
            {" "}Copy a phase's ingredient list to the clipboard from the active bake runner.
          </Text>
          <Text style={[styles.changelogBullet, { color: colors.foreground, marginTop: 6 }]}>
            <Text style={styles.changelogLabel}>Fixed:</Text>
            {" "}Calendar tab no longer erases locally saved sessions when cloud sync returns incomplete results.
          </Text>
          <Text style={[styles.changelogBullet, { color: colors.foreground, marginTop: 6 }]}>
            <Text style={styles.changelogLabel}>Fixed:</Text>
            {" "}Temperature reading label now shows "(°C or °F)" since values are not converted automatically.
          </Text>
          <Text style={[styles.changelogBullet, { color: colors.foreground, marginTop: 6 }]}>
            <Text style={styles.changelogLabel}>Fixed:</Text>
            {" "}"Add Phases" button was clipped at the bottom of the screen on some devices.
          </Text>
          <Text style={[styles.changelogBullet, { color: colors.foreground, marginTop: 6 }]}>
            <Text style={styles.changelogLabel}>Fixed:</Text>
            {" "}Recipes were not restored when signing in on a fresh install — they now sync correctly alongside feeds and bakes.
          </Text>
          <Text style={[styles.changelogBullet, { color: colors.foreground, marginTop: 6 }]}>
            <Text style={styles.changelogLabel}>Fixed:</Text>
            {" "}Feed photo now displays at full card width with a proportional 4:3 aspect ratio instead of a small fixed-height preview.
          </Text>
        </View>

        <View style={[styles.changelogEntry, { borderBottomColor: colors.border }]}>
          <Text style={[styles.changelogVersion, { color: colors.foreground }]}>v1.0.1</Text>
          <Text style={[styles.changelogBullet, { color: colors.foreground }]}>
            <Text style={styles.changelogLabel}>Removed:</Text>
            {" "}pH over-time chart from the Active Feed view and its corresponding Help reference.
          </Text>
        </View>

      </View>

      {/* ── Version ── */}
      <Text style={[styles.versionLabel, { color: colors.mutedForeground }]}>
        Version {appConfig.expo.version} ({appConfig.expo.android.versionCode})
      </Text>
    </ScrollView>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 20,
  },

  logoWrap: {
    alignItems: "center",
    marginBottom: 36,
  },
  logo: {
    width: 260,
    height: 160,
    borderRadius: 4,
  },

  sectionLabel: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 10,
    paddingBottom: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },

  // Simple non-accordion card (Contact)
  card: {
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 28,
    overflow: "hidden",
  },

  contactRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  contactIcon: {
    marginRight: 12,
  },
  contactText: {
    fontSize: 15,
    fontFamily: "Inter_500Medium",
  },

  // Accordion card wrapping one tab's help content
  accordionCard: {
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 10,
    overflow: "hidden",
  },
  accordionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  accordionTitle: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
    flex: 1,
    marginRight: 8,
  },
  accordionBody: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 16,
  },

  // Sub-section heading inside an expanded accordion
  subHeading: {
    fontSize: 10,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 0.8,
    marginBottom: 10,
  },
  subSectionGap: {
    marginTop: 18,
  },

  // Individual bullet row
  bulletRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: 8,
    gap: 8,
  },
  bulletDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    marginTop: 9,
    opacity: 0.5,
    flexShrink: 0,
  },
  bulletText: {
    flex: 1,
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    lineHeight: 20,
  },
  bulletLabel: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 13,
  },

  changelogEntry: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  changelogVersion: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    marginBottom: 4,
  },
  changelogBullet: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    lineHeight: 20,
  },
  changelogLabel: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 13,
  },

  versionLabel: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    marginTop: 8,
    marginBottom: 4,
  },

  settingRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
  },
  settingText: {
    flex: 1,
  },
  settingTitle: {
    fontSize: 15,
    fontFamily: "Inter_500Medium",
    marginBottom: 2,
  },
  settingDescription: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    lineHeight: 17,
  },

  interpretEntry: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 6,
  },
  interpretHeading: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
    marginBottom: 2,
  },
  interpretBody: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    lineHeight: 20,
  },
  interpretPlaceholder: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    fontStyle: "italic",
    marginTop: 4,
  },
});
