import React from "react";
import { InoculantPill } from "../InoculantPill";
import { WildYeastIcon, CommercialYeastIcon, HybridCultureIcon, PrefermentIcon } from "../InoculationIcons";

describe("Stitch inoculation icons", () => {
  it.each([
    ["wild", WildYeastIcon],
    ["commercial", CommercialYeastIcon],
    ["hybrid", HybridCultureIcon],
    ["preferment", PrefermentIcon],
  ] as const)("renders the %s SVG design", (_name, Icon) => {
    const svg = Icon({ size: 16, color: "#123456" }) as React.ReactElement<any>;
    expect(svg.props).toEqual(expect.objectContaining({ width: 16, height: 16, viewBox: "0 0 24 24" }));
    expect(React.Children.count(svg.props.children)).toBeGreaterThan(0);
  });
});

describe("InoculantPill", () => {
  it.each([
    ["sourdough", "Sourdough Starter", WildYeastIcon, "#FDF0E6", "#F0CCB3", "#9A3F00"],
    ["commercial", "Commercial Yeast", CommercialYeastIcon, "#FBF4DC", "#E9D696", "#805600"],
    ["hybrid", "Hybrid Culture", HybridCultureIcon, "#EEF3F0", "#C4D4CB", "#14513B"],
    ["preferment", "Preferment / Poolish", PrefermentIcon, "#F6F1EB", "#DDD0C3", "#5D3A26"],
  ] as const)("renders %s in light mode", (identity, label, Icon, backgroundColor, borderColor, color) => {
    const pill = InoculantPill({ identity }) as React.ReactElement<any>;
    const children = React.Children.toArray(pill.props.children) as React.ReactElement<any>[];
    expect(pill.props.testID).toBe("inoculant-pill");
    expect(pill.props.style[1]).toEqual({ backgroundColor, borderColor });
    expect(pill.props.style[0]).toEqual(expect.objectContaining({ height: 25, alignItems: "center" }));
    expect(children[0].type).toBe(Icon);
    expect(children[0].props).toEqual(expect.objectContaining({ size: 16, color }));
    expect(children[0].props.fillDough).toBe(identity === "commercial" ? undefined : backgroundColor);
    expect(children[0].props.fillSurface).toBe(identity === "preferment" ? undefined : backgroundColor);
    expect(children[1].props.children).toBe(label);
    expect(children[1].props.style[1]).toEqual({ color });
  });

  it.each([
    ["sourdough", "#543624", "#A66B45", "#FFD0AD"],
    ["commercial", "#514321", "#9B8140", "#F8DE91"],
    ["hybrid", "#243F33", "#5B8973", "#BCE8CF"],
    ["preferment", "#46372D", "#927966", "#F1D8C5"],
  ] as const)("renders %s in dark mode", (identity, backgroundColor, borderColor, color) => {
    const pill = InoculantPill({ identity, dark: true }) as React.ReactElement<any>;
    const children = React.Children.toArray(pill.props.children) as React.ReactElement<any>[];
    expect(pill.props.style[1]).toEqual({ backgroundColor, borderColor });
    expect(children[0].props.color).toBe(color);
    expect(children[1].props.style[1]).toEqual({ color });
  });

  it("omits an unresolved identity", () => {
    expect(InoculantPill({ identity: null })).toBeNull();
  });
});
