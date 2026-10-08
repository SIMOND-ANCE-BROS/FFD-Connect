import AsyncStorage from "@react-native-async-storage/async-storage";
import { render, screen } from "@testing-library/react-native";
import React from "react";
import { AuthService } from "../../../auth/services/AuthService";
import { useAuthStore } from "../../../../stores/auth.store";
import { SpaceSelector } from "../SpaceSelector";

// Real AuthService + real store + real selector: only the network edges go.
jest.mock("../../../../services/api", () => ({
  get: jest.fn(),
  post: jest.fn(),
}));
jest.mock("../../../settings/services/pushRegistration", () => ({
  registerDeviceTokenForPush: jest.fn(),
  unregisterDeviceTokenForPush: jest.fn(),
}));
jest.mock("../../../../context/ThemeContext", () => ({
  useTheme: () => ({
    theme: {
      surface: "#fff",
      text: "#000",
      textSecondary: "#666",
      border: "#eee",
      primary: "#3b82f6",
    },
    isDark: false,
  }),
}));

const signedIn = (o: object) =>
  AsyncStorage.setItem(
    "auth_config",
    JSON.stringify({
      isLoggedIn: true,
      username: "a@x.fr",
      role: "LICENSEE",
      roles: ["LICENSEE"],
      mainRole: "LICENSEE",
      ...o,
    }),
  );

const renderSelector = () => {
  const { roles, role } = useAuthStore.getState();
  return render(
    <SpaceSelector roles={roles} space={role} onChange={jest.fn()} />,
  );
};

describe("role sync from /users/me → space selector", () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it("shows the selector once the profile brings a new role", async () => {
    await signedIn({});
    await useAuthStore.getState().refreshAuth();
    await renderSelector();
    expect(screen.queryByText("Espace")).toBeNull();

    await AuthService.syncRolesFromProfile({
      email: "a@x.fr",
      role: "LICENSEE",
      roles: ["LICENSEE", "CLUB"],
    });
    await useAuthStore.getState().refreshAuth();
    await renderSelector();

    expect(screen.getByText("Espace")).toBeTruthy();
    expect(useAuthStore.getState().role).toBe("LICENSEE");
  });

  it("falls back to the main role when the active space's role is removed", async () => {
    await signedIn({ role: "CLUB", roles: ["LICENSEE", "CLUB"] });

    await AuthService.syncRolesFromProfile({
      email: "a@x.fr",
      role: "LICENSEE",
      roles: ["LICENSEE"],
    });
    await useAuthStore.getState().refreshAuth();

    expect(useAuthStore.getState()).toMatchObject({
      role: "LICENSEE",
      roles: ["LICENSEE"],
    });
    await renderSelector();
    expect(screen.queryByText("Espace")).toBeNull();
  });
});
