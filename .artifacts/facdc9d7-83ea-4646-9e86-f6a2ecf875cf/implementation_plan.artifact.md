# Fix EAS Build compatibility for Sourdough build scripts

The current Android build configuration for the "Sourdough" artifacts contains several Windows-specific optimizations and hacks designed to bypass the 260-character path limit. These include:
- Redirecting build directories to short paths like `C:/b/`.
- Using `cmd.exe` to create directory junctions (`mklink /J`).
- Hardcoded absolute paths containing the user's local directory structure.

These cause the EAS build (which runs on Linux) to fail with `Cannot run program "cmd": error=2, No such file or directory`.

## User Review Required

> [!IMPORTANT]
> The build script currently relies on several short paths at the root of the C: drive (`C:/b`, `C:/x`, `C:/j`, `C:/g`). These are preserved for Windows builds but will be skipped on Linux/EAS builds. If path length issues occur on EAS, we will need to explore alternative shortening strategies for Linux (though it is much less of an issue there than on Windows).

## Proposed Changes

### [Component: Build Configuration]

#### [MODIFY] [build.gradle](file:///C:/Users/LRLNH/Documents/AndroidProjects/Bread-Lab/artifacts/sourdough/android/build.gradle)
- **OS Detection**: Add logic to detect if the build is running on Windows.
- **Conditional Execution**: Wrap all Windows-specific logic (path redirects, junction creation, and `cmd` calls) in an `if (isWindows)` block.
- **Dynamic Path Matching**: Replace hardcoded local paths in regexes with dynamic paths derived from the project root.

## Verification Plan

### Manual Verification
- Review the modified `build.gradle` to ensure all `cmd` calls and `C:/` references are protected by the `isWindows` check.
- The user will need to trigger a new EAS build to confirm the fix.
