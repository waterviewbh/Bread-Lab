# Bug Tracker & Known Issues

This file tracks intermittent issues, build flakiness, and native configuration problems that require monitoring.

## Active Issues

### 1. C/C++ Configuration Timeout (Windows)
- **Status**: Monitoring
- **Symptom**: "Compiler command timed out during compiler information collection" for `expo-modules-core`.
- **First Observed**: 2026-09-12
- **Mitigation**: 
    - Increased `Compiler information collection timeout` to 120 seconds in Android Studio Advanced Settings.
    - Recommended: Add Android SDK path to Windows Defender exclusion list.
- **Notes**: Common on Windows due to slow process invocation. Often clears after a manual Gradle sync or cache invalidation.
