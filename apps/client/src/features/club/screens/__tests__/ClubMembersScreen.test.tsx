import { fireEvent, render } from "@testing-library/react-native";
import React from "react";
// import { mockUseNavigation } from '../../../../__tests__/mocks/mockNavigation';
import { useClubMembersLogic } from "../../hooks/useClubMembersLogic";
import { ClubMembersScreen } from "../ClubMembersScreen";

jest.mock("../../hooks/useClubMembersLogic");

// Inline ThemeContext Mock
jest.mock("../../../../context/ThemeContext", () => ({
  ThemeProvider: ({ children }: { children: React.ReactNode }) => children,
  useTheme: () => ({
    theme: {
      background: "#fff",
      surface: "#f2f2f2",
      text: "#111",
      textSecondary: "#666",
      primary: "#3b82f6",
      border: "#e5e7eb",
      danger: "#ef4444",
      colors: { primary: "blue", background: "white" },
      dark: false,
    },
  }),
}));

// Inline Navigation Mock
jest.mock("@react-navigation/native", () => {
  return {
    ...jest.requireActual("@react-navigation/native"),
    useNavigation: () => ({
      navigate: jest.fn(),
      goBack: jest.fn(),
      setOptions: jest.fn(),
      addListener: jest.fn(() => jest.fn()),
      dispatch: jest.fn(),
      reset: jest.fn(),
      isFocused: jest.fn().mockReturnValue(true),
      canGoBack: jest.fn().mockReturnValue(true),
      getParent: jest.fn(),
      getState: jest.fn(),
    }),
  };
});

// Mock AppText
jest.mock("../../../../components/AppText");

// Mock Icons
jest.mock("lucide-react-native", () => {
  const { createElement } = require("react");
  const { Text } = require("react-native");
  return {
    MoreVertical: () => createElement(Text, {}, "MoreVertical"),
    Plus: () => createElement(Text, {}, "Plus"),
    Search: () => createElement(Text, {}, "Search"),
    User: () => createElement(Text, {}, "User"),
    Award: () => createElement(Text, {}, "Award"),
    ChevronLeft: () => createElement(Text, {}, "ChevronLeft"),
    X: () => createElement(Text, {}, "X"),
  };
});

// Mock SafeAreaView
jest.mock("react-native-safe-area-context", () => {
  return {
    SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  };
});

describe("ClubMembersScreen", () => {
  const mockMembers = [
    {
      id: "m1",
      firstName: "Jean",
      lastName: "Dupont",
      license: { number: "LIC-123" },
    },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
  });

  const mockNavigation = {
    navigate: jest.fn(),
    goBack: jest.fn(),
    setOptions: jest.fn(),
    addListener: jest.fn(() => jest.fn()),
    dispatch: jest.fn(),
    reset: jest.fn(),
    isFocused: jest.fn().mockReturnValue(true),
    canGoBack: jest.fn().mockReturnValue(true),
    getParent: jest.fn(),
    getState: jest.fn(),
  };

  it("renders members list and navigates to member editor", async () => {
    // We need to mock the hook to return our local mockNavigation
    // But @react-navigation/native usage in component is `useNavigation()`.
    // Our inline mock returns a fresh object every time?
    // "useNavigation: () => ({ ... })" - yes.
    // So to assert, we need to spy on it or assume the component uses the one we provided?
    // Wait, `ClubMembersScreen` calls `useNavigation()`.
    // The test asserts `expect(navigation.navigate).toHaveBeenCalledWith...`
    // If `useNavigation` returns a NEW object every time, `navigation` variable in test won't match.

    // Better approach: Mock `useNavigation` to return a constant mock object defined in the mock factory?
    // Or we can rely on `mockUseNavigation` from `__tests__/mocks/mockNavigation` if we use `require` inside the test?

    // Let's use `require` inside the test to get the mocked module's `useNavigation`.
    // Actually, checking `CompetitionsScreen.test.tsx`, I passed `mockNavigation` as a PROP.
    // `ClubMembersScreen.tsx` calls `useNavigation()` hook directly! It does NOT take props.

    // So I need to control what `useNavigation` returns.

    const navigation = mockNavigation;
    require("@react-navigation/native").useNavigation = jest.fn(
      () => navigation,
    );

    (useClubMembersLogic as jest.Mock).mockReturnValue({
      members: mockMembers,
      isLoading: false,
      searchQuery: "",
      setSearchQuery: jest.fn(),
      refresh: jest.fn().mockResolvedValue(undefined),
    });

    const { getByText } = await render(<ClubMembersScreen />);

    expect(getByText("Jean Dupont")).toBeTruthy();

    await fireEvent.press(getByText("Jean Dupont"));
    expect(navigation.navigate).toHaveBeenCalledWith("ClubMemberEditor", {
      member: mockMembers[0],
    });
  });

  it("navigates to add member", async () => {
    const navigation = mockNavigation;
    require("@react-navigation/native").useNavigation = jest.fn(
      () => navigation,
    );

    (useClubMembersLogic as jest.Mock).mockReturnValue({
      members: [],
      isLoading: false,
      searchQuery: "",
      setSearchQuery: jest.fn(),
      refresh: jest.fn().mockResolvedValue(undefined),
    });

    const { getByText } = await render(<ClubMembersScreen />);

    await fireEvent.press(getByText("Ajouter"));
    expect(navigation.navigate).toHaveBeenCalledWith("ClubMemberEditor");
  });
});
