import { ScrollViewStyleReset } from "expo-router/html";
import type { PropsWithChildren } from "react";

export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, shrink-to-fit=no"
        />

        <title>Bread Lab — Sourdough Tracker</title>
        <meta
          name="description"
          content="Bread Lab is a sourdough baker's companion — track starter feeds, log pH and temperature readings, run recipe phases with live timers, chart fermentation over time, and bake with volume tracking and notes."
        />
        <meta name="robots" content="index, follow" />

        <meta property="og:type" content="website" />
        <meta property="og:title" content="Bread Lab — Sourdough Tracker" />
        <meta
          property="og:description"
          content="Track sourdough starter feeds, log pH readings, monitor fermentation, and bake better bread."
        />

        <ScrollViewStyleReset />
      </head>
      <body>{children}</body>
    </html>
  );
}
