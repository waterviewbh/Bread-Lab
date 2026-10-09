import React from 'react';
import { Redirect } from 'expo-router';

/**
 * Route handler for sourdough://share deep links.
 * Redirects incoming share intent links directly to the home screen (Landing Page)
 * so the share toast and Candidate Inbox render on top of the main Workbench.
 */
export default function ShareRoute() {
  return <Redirect href="/" />;
}
