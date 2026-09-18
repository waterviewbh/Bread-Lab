-- Seed script for science_articles
-- Run this in the Supabase SQL editor to populate the initial scholarly content.

INSERT INTO public.science_articles (slug, title, is_published, blocks, further_study_topics)
VALUES (
  'bulk_engine_physics',
  'The Physics of Bulk Fermentation: Thermal Mass & Rate Tracking',
  true,
  '[
    {
      "type": "paragraph",
      "text": "The **Sourdough Bread Lab** app moves beyond simple timers by modeling *dynamic* thermal momentum, degree-hours, and both temperature and volume velocity tracking.",
      "italic": true
    },
    {
      "type": "heading",
      "text": "Thermal Momentum & Inverse Volume Targets"
    },
    {
      "type": "paragraph",
      "text": "Yeast metabolic activity scales exponentially with temperature. Warm dough (>80°F) has significant metabolic momentum (carryover yeast activity) and continues fermenting in cold retard, like when placed in the fridge. This momentum means the dough requires a lower rise target at shaping, closer to 35%–40%. Cool dough (68°F) has low thermal momentum, so a higher rise target (closer to 100%) makes sense before chilling."
    },
    {
      "type": "heading",
      "text": "Newton''s Law of Cooling & Dough Thermal Velocity"
    },
    {
      "type": "paragraph",
      "text": "Heat transfer between room air and dough core follows continuous decay. Rather than taking static snapshots, the engine projects dynamic thermal curves as dough acclimates to ambient kitchen conditions:"
    },
    {
      "type": "equation",
      "text": "\\frac{dT}{dt} = k \\cdot (T_{\\text{ambient}} - T_{\\text{dough}}),"
    },
    {
      "type": "paragraph",
      "text": "where k = 0.4 hr⁻¹ represents the heat transfer coefficient for a standard loaf mass. By modeling this temperature trajectory, the engine can accurately predict future temperature values before changes are seen in your bowl''s volume."
    },
    {
      "type": "heading",
      "text": "Applying Proportional-Derivative Controls"
    },
    {
      "type": "paragraph",
      "text": "Like temperature, your dough''s volume also has a velocity, measured as dV/dt. This allows the app to estimate completion time based on how close the dough is to its target rise % (based on temperature) and how quickly it''s approaching that target. The ability to specify degassing (e.g., additional folds) complements these ongoing calculations. Here, the blended velocity expresses the dough''s volume rise toward the target:"
    },
    {
      "type": "equation",
      "text": "\\text{Velocity}_{\\text{blended}} = (\\alpha \\times \\text{Velocity}_{\\text{live}}) + ((1 - \\alpha) \\times \\text{Velocity}_{\\text{baseline}}),"
    },
    {
      "type": "paragraph",
      "text": "where α is close to 0 early in the bulk, meaning the blended velocity relies primarily on a baseline velocity model built into the app. It gets closer to 1 as time goes on, meaning the blended velocity relies more on the live velocity as the dough gets closer to completion. Gas expansion is exponential, so this approach allows the app to adapt to changing variables more meaningfully than just relying on a clock."
    }
  ]'::jsonb,
  '[
    "Arrhenius Equation & Thermal Kinetics in Wild Yeast vs. LAB",
    "Viscoelasticity & Gas Retention Limits in High-Hydration Gluten Matrices",
    "Osmotic Pressure Dynamics: Microbial Retardation from Salt and Enriched Sugars",
    "Sigmoidal Growth Curves: Gompertz vs. Logistic Modeling in Biological Fermentation"
  ]'::jsonb
)
ON CONFLICT (slug) DO UPDATE
SET
  title = EXCLUDED.title,
  blocks = EXCLUDED.blocks,
  further_study_topics = EXCLUDED.further_study_topics,
  updated_at = NOW();
