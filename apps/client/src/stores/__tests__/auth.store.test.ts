import AsyncStorage from "@react-native-async-storage/async-storage";
import { useAuthStore } from "../auth.store";

describe("auth.store roles", () => {
  it("hydrates roles and answers hasRole across spaces", async () => {
    await AsyncStorage.setItem(
      "auth_config",
      JSON.stringify({
        isLoggedIn: true,
        role: "LICENSEE",
        mainRole: "ADMIN",
        roles: ["ADMIN", "LICENSEE"],
      }),
    );
    await useAuthStore.getState().refreshAuth();
    const s = useAuthStore.getState();
    expect(s.role).toBe("LICENSEE");
    expect(s.mainRole).toBe("ADMIN");
    expect(s.hasRole("ADMIN")).toBe(true);
    expect(s.hasRole("CLUB")).toBe(false);
  });

  it("falls back to [role] when roles are missing", async () => {
    await AsyncStorage.setItem(
      "auth_config",
      JSON.stringify({ isLoggedIn: true, role: "CLUB" }),
    );
    await useAuthStore.getState().refreshAuth();
    expect(useAuthStore.getState().roles).toEqual(["CLUB"]);
  });

  it("falls back to the main role when the stored space is no longer held", async () => {
    await AsyncStorage.setItem(
      "auth_config",
      JSON.stringify({
        isLoggedIn: true,
        role: "CLUB",
        mainRole: "LICENSEE",
        roles: ["LICENSEE"],
      }),
    );
    await useAuthStore.getState().refreshAuth();
    expect(useAuthStore.getState().role).toBe("LICENSEE");
  });

  it("ignores unknown roles in the stored list", async () => {
    await AsyncStorage.setItem(
      "auth_config",
      JSON.stringify({
        isLoggedIn: true,
        role: "LICENSEE",
        roles: ["LICENSEE", "WIZARD"],
      }),
    );
    await useAuthStore.getState().refreshAuth();
    expect(useAuthStore.getState().roles).toEqual(["LICENSEE"]);
  });

  it("clears roles when there is no stored config", async () => {
    await AsyncStorage.removeItem("auth_config");
    await useAuthStore.getState().refreshAuth();
    const s = useAuthStore.getState();
    expect(s.roles).toEqual([]);
    expect(s.mainRole).toBeNull();
    expect(s.hasRole("ADMIN")).toBe(false);
  });
});
