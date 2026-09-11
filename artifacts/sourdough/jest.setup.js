import '@testing-library/jest-native/extend-expect';

// Mock globals that might be missing in Node environment
global.window = {};
global.Alert = { alert: jest.fn() };

// Mock AsyncStorage
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

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
}));
