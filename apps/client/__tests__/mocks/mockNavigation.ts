export const mockNavigate = jest.fn();
export const mockGoBack = jest.fn();
export const mockSetOptions = jest.fn();
export const mockAddListener = jest.fn(() => jest.fn());
export const mockDispatch = jest.fn();
export const mockReset = jest.fn();
export const mockIsFocused = jest.fn().mockReturnValue(true);
export const mockCanGoBack = jest.fn().mockReturnValue(true);
export const mockGetParent = jest.fn();
export const mockGetState = jest.fn();
export const mockReplace = jest.fn();

export const mockNavigation = {
  navigate: mockNavigate,
  goBack: mockGoBack,
  setOptions: mockSetOptions,
  addListener: mockAddListener,
  dispatch: mockDispatch,
  reset: mockReset,
  isFocused: mockIsFocused,
  canGoBack: mockCanGoBack,
  getParent: mockGetParent,
  getState: mockGetState,
  replace: mockReplace,
};

export const mockUseNavigation = jest.fn(() => mockNavigation);
