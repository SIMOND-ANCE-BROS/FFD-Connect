module.exports = {
  preset: 'jest-expo',
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|@react-navigation|react-native-reanimated|react-native-share|react-native-gesture-handler|react-native-qrcode-svg|lucide-react-native|react-native-svg|react-native-track-player|react-native-vision-camera|react-native-draggable-flatlist|react-native-google-places-autocomplete|react-native-safe-area-context|react-native-worklets|@testing-library|expo(?!-modules-core)|expo-modules-core|@sentry)/)',
  ],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  modulePathIgnorePatterns: ['<rootDir>/e2e'],
  testPathIgnorePatterns: ['/node_modules/', '/mocks/', '/__tests__/mocks/'],
  setupFiles: ['./jest.setup-early.js'],
};
