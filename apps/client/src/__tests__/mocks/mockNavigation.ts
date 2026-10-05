export const mockNavigate = jest.fn();
export const mockGoBack = jest.fn();
export const mockSetOptions = jest.fn();

export const mockNavigation = {
  navigate: mockNavigate,
  goBack: mockGoBack,
  setOptions: mockSetOptions,
  addListener: jest.fn(() => jest.fn()), // Return unsubscribe function
  dispatch: jest.fn(),
  reset: jest.fn(),
  isFocused: jest.fn().mockReturnValue(true),
  canGoBack: jest.fn().mockReturnValue(true),
  getParent: jest.fn(),
  getState: jest.fn(),
} as unknown as import("@react-navigation/native").NavigationProp<
  Record<string, object | undefined>
>;

// Helper to reset all navigation mocks
export const mockUseNavigation = jest.fn(() => mockNavigation);
export const mockUseRoute = jest.fn(() => ({ params: {} }));

export const resetNavigationMocks = () => {
  mockNavigate.mockClear();
  mockGoBack.mockClear();
  mockSetOptions.mockClear();
  mockUseNavigation.mockClear();
  mockUseRoute.mockClear();
};
