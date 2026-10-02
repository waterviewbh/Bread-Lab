# Visual Verification & Screenshot Protocol

## Objective
Establish a reliable, multi-tiered visual testing protocol for Bread Lab to ensure that UI modifications, responsive layout adjustments, and new component renders are verified visual changes before declaring task completion.

---

## 3-Tier Visual Testing Architecture

```
[ Tier 1: In-Process RNTL Structural Snapshots ]  <-- Instant, headless in Jest
                      │
                      ▼
[ Tier 2: Maestro E2E Visual Artifact Capture ]   <-- Full UI render flow on device/emulator
                      │
                      ▼
[ Tier 3: Agent Visual Inspection Protocol ]      <-- IDE / ADB screenshot capture & verification
```

---

### Tier 1: RNTL Component & Layout Tree Snapshots
* **Scope**: Individual React Native components (`PhaseCard`, `YieldPill`, `BakeSelectorTabs`) and custom hooks.
* **Execution**: Fast, headless execution in Jest using `@testing-library/react-native`.
* **Usage**:
  ```tsx
  import { render } from '@testing-library/react-native';
  import { PhaseCard } from '../PhaseCard';

  it('renders PhaseCard layout correctly', () => {
    const { toJSON } = render(<PhaseCard phase={mockPhase} />);
    expect(toJSON()).toMatchSnapshot();
  });
  ```

---

### Tier 2: Maestro Automated Visual Inspection
* **Scope**: Full End-to-End user journeys across active bakes, recipe creation, and navigation hubs.
* **Execution**: Automated YAML flows running against physical or emulated devices via `maestro test`.
* **Usage**: Inject `takeScreenshot` steps after key UI animations and screen transitions settle:
  ```yaml
  appId: com.breadlab.app
  ---
  - runFlow: subflows/open_app.yaml
  - tapOn:
      id: "recipe-builder-btn"
  - waitForAnimationToEnd
  - takeScreenshot: "artifacts/screenshots/recipe_builder_open.png"
  ```

---

### Tier 3: Agent Visual Inspection Workflow
* **Scope**: On-demand visual verification during AI agent task execution when modifying UI components, theme tokens, or responsive layouts.
* **Execution Protocol**:
  1. **Deployment / Preview Launch**:
     - Launch target screen via Expo Dev Build or Compose Preview / ADB screen dump.
  2. **Screenshot Capture**:
     - Invoke `adb_shell_input` or native screenshot tool to capture target screen into `.artifacts/af645c52-6f47-4a60-a0c0-3476c2b44966/` artifacts directory.
  3. **Visual Audit Checklist**:
     - [ ] **Contrast & Theme Alignment**: Verify light/dark theme color tokens apply consistently.
     - [ ] **Touch Target Bounds**: Ensure buttons and interactive pills satisfy $48\times48\text{ dp}$ minimum touch targets.
     - [ ] **Text Clipping & Responsiveness**: Confirm text strings expand gracefully without clipping on various display density profiles.
  4. **Walkthrough Document Inclusion**:
     - Embed captured PNG screenshots into `walkthrough.artifact.md` to visually demonstrate UI changes.

---

## Maintenance & Summary
- Tier 1 Jest RNTL snapshots run automatically on every pre-commit and CI build.
- Tier 2 Maestro screenshots are preserved in build artifacts for visual regression comparison.
- Tier 3 agent inspection provides deterministic evidence of UI correctness before task sign-off.
