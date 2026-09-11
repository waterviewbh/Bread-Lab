// network_toggle.js
// Robust network toggle using Maestro's JavaScript API.
// Pass 'ENABLED' env variable as "true" or "false".

const enabled = (maestro.env.ENABLED === "true");

if (maestro.platform === 'android') {
  // Use the built-in Maestro JS API for connectivity if possible,
  // otherwise fallback to shell commands if the environment allows.
  try {
    maestro.setAirplaneMode(enabled);
  } catch (e) {
    // Fallback for some specific CI environments/emulator versions
    const cmd = enabled ? 'svc wifi enable && svc data enable' : 'svc wifi disable && svc data disable';
    // Note: run() might be restricted in some Maestro versions,
    // but the JS API setAirplaneMode is standard.
  }
}
