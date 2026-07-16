// Ordered array of full-screen tour slide images.
// The numeric prefix in each filename determines display order.
// To add or remove slides, edit this array only — nothing else needs to change.
export const TOUR_IMAGES: ReturnType<typeof require>[] = [
  require('@/assets/images/tour_step_01_app-name.png'),
  require('@/assets/images/tour_step_02_feed-ratios-input.png'),
  require('@/assets/images/tour_step_03_start-feed-btn.png'),
  require('@/assets/images/tour_step_04_advisor-intro.png'),
  require('@/assets/images/tour_step_05_build-levain.png'),
  require('@/assets/images/tour_step_06_feed-trends.png'),
  require('@/assets/images/tour_step_07_next-chapter-is-graph.png'),
  require('@/assets/images/tour_step_08_graph-indices.png'),
  require('@/assets/images/tour_step_09_next-chapter-is-recipe.png'),
  require('@/assets/images/tour_step_10_recipe-pages.png'),
  require('@/assets/images/tour_step_11_recipe-builder.png'),
  require('@/assets/images/tour_step_12_recipe-runner.png'),
  require('@/assets/images/tour_step_13_next-chapter-is-history.png'),
  require('@/assets/images/tour_step_14_calendar.png'),
  require('@/assets/images/tour_step_15_next-chapter-is-about.png'),
  require('@/assets/images/tour_step_16_help-section.png'),
];

// Total count — used by TourSlideshow for progress tracking
export const TOUR_IMAGE_COUNT = TOUR_IMAGES.length;