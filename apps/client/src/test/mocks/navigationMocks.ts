import {
  NavigationProp,
  ParamListBase,
  RouteProp,
} from "@react-navigation/native";

export const mockNavigate = jest.fn();
export const mockGoBack = jest.fn();
export const mockSetOptions = jest.fn();
export const mockDispatch = jest.fn();
export const mockEmit = jest.fn();

export const mockNavigation = {
  navigate: mockNavigate,
  goBack: mockGoBack,
  setOptions: mockSetOptions,
  dispatch: mockDispatch,
  addListener: jest.fn(() => jest.fn()),
  removeListener: jest.fn(),
  reset: jest.fn(),
  isFocused: jest.fn(() => true),
  canGoBack: jest.fn(() => true),
  getParent: jest.fn(),
  getState: jest.fn(),
  setParams: jest.fn(),
  emit: mockEmit,
} as unknown as NavigationProp<ParamListBase>;

export const createMockRoute = (
  name: string,
  params: Record<string, unknown> = {},
): RouteProp<ParamListBase, string> => ({
  key: `${name}-key`,
  name,
  params,
  path: undefined,
});
