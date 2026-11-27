import React from "react";
import { InoculantPill } from "../InoculantPill";

jest.mock("@expo/vector-icons", () => ({ Feather: "Feather" }));

describe("InoculantPill", () => {
  it.each([
    ["sourdough", "Sourdough Starter", "#FDF0E6", "#F0CCB3", "#9A3F00"],
    ["commercial", "Commercial Yeast", "#FBF4DC", "#E9D696", "#805600"],
    ["hybrid", "Hybrid Culture", "#EEF3F0", "#C4D4CB", "#14513B"],
  ] as const)("renders %s consistently", (identity, label, backgroundColor, borderColor, color) => {
    const pill = InoculantPill({ identity }) as React.ReactElement<any>;
    const children = React.Children.toArray(pill.props.children) as React.ReactElement<any>[];
    expect(pill.props.testID).toBe("inoculant-pill");
    expect(pill.props.style[1]).toEqual({ backgroundColor, borderColor });
    expect(pill.props.style[0]).toEqual(expect.objectContaining({ height: 25, alignItems: "center" }));
    expect(children[0].props).toEqual(expect.objectContaining({ size: 11, color }));
    expect(children[1].props.children).toBe(label);
    expect(children[1].props.style[1]).toEqual({ color });
  });

  it.each([
    ["sourdough", "#543624", "#A66B45", "#FFD0AD"],
    ["commercial", "#514321", "#9B8140", "#F8DE91"],
    ["hybrid", "#243F33", "#5B8973", "#BCE8CF"],
  ] as const)("uses a distinct dark palette for %s", (identity, backgroundColor, borderColor, color) => {
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
