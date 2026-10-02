import '@testing-library/jest-native/extend-expect';

// Enable React 19 concurrent act environment flag
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Mock globals that might be missing in Node environment
global.Alert = { alert: jest.fn() };

// Mock AsyncStorage
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

// Mock Expo Vector Icons
jest.mock('@expo/vector-icons', () => ({
  Feather: 'Feather',
  Ionicons: 'Ionicons',
  MaterialCommunityIcons: 'MaterialCommunityIcons',
  FontAwesome: 'FontAwesome',
  AntDesign: 'AntDesign',
}));

// Mock Expo Google Fonts
jest.mock('@expo-google-fonts/libre-caslon-text', () => ({
  useFonts: () => [true, null],
}));
jest.mock('@expo-google-fonts/inter', () => ({
  useFonts: () => [true, null],
}));
jest.mock('@expo-google-fonts/hanken-grotesk', () => ({
  useFonts: () => [true, null],
}));
jest.mock('@expo-google-fonts/jetbrains-mono', () => ({
  useFonts: () => [true, null],
}));

// Mock Expo constants
jest.mock('expo-constants', () => ({
  manifest: {},
  expoConfig: {},
}));

// Mock Expo Font
jest.mock('expo-font', () => ({
  isLoaded: jest.fn(() => true),
  loadAsync: jest.fn(),
}));

// Mock Expo Crypto
jest.mock('expo-crypto', () => ({
  randomUUID: jest.fn(() => 'test-uuid'),
}));

// Mock Expo Router
jest.mock('expo-router', () => ({
  useRouter: () => ({
    push: jest.fn(),
    replace: jest.fn(),
    back: jest.fn(),
  }),
  useLocalSearchParams: () => ({}),
  useFocusEffect: (cb: any) => {
    const React = require('react');
    React.useEffect(() => {
      const cleanup = cb();
      return () => {
        if (typeof cleanup === 'function') cleanup();
      };
    }, []);
  },
}));

// Mock Expo Print, Sharing, FileSystem
jest.mock('expo-print', () => ({
  printAsync: jest.fn().mockResolvedValue(undefined),
  printToFileAsync: jest.fn().mockResolvedValue({ uri: 'file://test.pdf' }),
}));

jest.mock('expo-sharing', () => ({
  isAvailableAsync: jest.fn().mockResolvedValue(true),
  shareAsync: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///documents/',
  cacheDirectory: 'file:///cache/',
  writeAsStringAsync: jest.fn().mockResolvedValue(undefined),
  readAsStringAsync: jest.fn().mockResolvedValue(''),
}));

jest.mock('expo-file-system', () => ({
  documentDirectory: 'file:///documents/',
  cacheDirectory: 'file:///cache/',
  writeAsStringAsync: jest.fn().mockResolvedValue(undefined),
  readAsStringAsync: jest.fn().mockResolvedValue(''),
}));

// Mock Copilot
jest.mock('react-native-copilot', () => ({
  copilot: () => (Comp: any) => Comp,
  useCopilot: () => ({ start: jest.fn(), copilotEvents: { on: jest.fn(), off: jest.fn() } }),
  walkthroughable: (Comp: any) => Comp,
}));

// Mock Timer Hooks for Component Tests
jest.mock('@/hooks/useActiveBakeTimer', () => ({
  useActiveBakeTimer: (bake: any) => {
    if (!bake?.phases) return {};
    const upd: Record<string, number> = {};
    bake.phases.forEach((p: any) => {
      if (p.startedAt && !p.completedAt) upd[p.key] = 10000;
    });
    return upd;
  },
}));

jest.mock('@/hooks/useBulkFermentTimer', () => ({
  useBulkFermentTimer: (state: any) => {
    if (state?.projectedTargetAt) return { mode: 'countdown', label: '01:00' };
    if (state?.targetReachedAt) return { mode: 'overtime', label: '+02:00' };
    return { mode: 'none', label: '' };
  },
}));

// Mock Expo Haptics
jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(),
  notificationAsync: jest.fn(),
  selectionAsync: jest.fn(),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
}));

// Mock Expo Clipboard
jest.mock('expo-clipboard', () => ({
  setStringAsync: jest.fn().mockResolvedValue(true),
  getStringAsync: jest.fn().mockResolvedValue(''),
}));

// Mock Expo Keep Awake
jest.mock('expo-keep-awake', () => ({
  useKeepAwake: jest.fn(),
  activateKeepAwakeAsync: jest.fn(),
  deactivateKeepAwake: jest.fn(),
}));

// Mock Safe Area Context
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  SafeAreaProvider: ({ children }: any) => children,
}));

// Mock Expo Symbols
jest.mock('expo-symbols', () => ({
  SymbolView: 'SymbolView',
}));

// Mock React Native Reanimated
jest.mock('react-native-reanimated', () => {
  const Reanimated = require('react-native-reanimated/mock');
  Reanimated.default.call = () => {};
  return Reanimated;
});
