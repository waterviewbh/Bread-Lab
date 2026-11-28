import { classifyInoculant } from "../inoculantIdentity";

const phases = (...ingredients: Array<string | { text: string }>) => [
  { key: "building_levain", ingredients },
];

describe("classifyInoculant", () => {
  it.each([
    ["sourdough", phases("100g sourdough starter"), "sourdough"],
    ["NLA-Loaf-003 master", phases("500 g flour", "375 g water", { text: "90 g peak starter" }), "sourdough"],
    ["instant yeast", phases("2g instant yeast"), "commercial"],
    ["active dry yeast", phases("2g active dry yeast"), "commercial"],
    ["hybrid", phases("100g levain", "2g instant yeast"), "hybrid"],
    ["generic yeast", phases("2g yeast"), null],
    ["no leavening", phases("500g flour", "350g water"), null],
    ["NLA-Loaf-002 iteration", phases("500 g flour", "350 g water", "11 g salt"), null],
    ["measured poolish", phases("100g poolish"), "preferment"],
    ["measured biga", phases("100g biga"), "preferment"],
    ["measured sponge", phases("100g sponge"), "preferment"],
    ["bare poolish", phases("poolish"), null],
    ["generic preferment", phases("100g preferment"), null],
    ["poolish-style", phases("100g poolish-style dough"), null],
    ["biga-like", phases("100g biga-like dough"), null],
    ["unmeasured sponge", phases("sponge"), null],
    ["preferment and starter", phases("100g biga", "90g peak starter"), null],
    ["preferment and yeast", phases("100g poolish", "2g instant yeast"), null],
    ["instant starter", phases("0.15g instant starter"), null],
    ["unqualified starter", phases("100g starter"), null],
    ["generic peaked phrase", phases("100g peak culture"), null],
    ["conflicting phrase", phases("instant yeast sourdough starter"), null],
    ["ambiguous hybrid", phases("100g levain", "2g yeast"), null],
    ["commercial in multiline string", [{ ingredients: "500g flour\n2g SAF yeast" }], "commercial"],
    ["hybrid in multiline string", [{ ingredients: "100g levain\n2g SAF yeast" }], "hybrid"],
    ["sourdough in CheckableLine", phases({ text: "100g sourdough discard" }), "sourdough"],
    ["across phases", [{ ingredients: ["100g levain"] }, { ingredients: [{ text: "2g active dry yeast" }] }], "hybrid"],
  ] as const)("%s", (_name, input, expected) => {
    expect(classifyInoculant(input)).toBe(expected);
  });
});
