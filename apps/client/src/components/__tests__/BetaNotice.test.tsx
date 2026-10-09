import { render } from "@testing-library/react-native";
import React from "react";
import { StyleSheet } from "react-native";
import { BETA_NOTICES } from "../../constants/betaNotices";
import { BetaNotice } from "../BetaNotice";

jest.mock("../../context/ThemeContext", () => ({
  useTheme: () => ({
    theme: { primary: "#0088CE", text: "#000000", textSecondary: "#666666" },
    isDark: false,
  }),
}));

describe("BetaNotice", () => {
  it("renders title and message in a single accessible text element", async () => {
    const { getByTestId, getByText } = await render(
      <BetaNotice title="Titre" message="Message" testID="notice" />,
    );

    const notice = getByTestId("notice");
    expect(notice.props.accessible).toBe(true);
    expect(notice.props.accessibilityRole).toBe("text");
    expect(getByText("Titre")).toBeTruthy();
    expect(getByText("Message")).toBeTruthy();
  });

  it("renders the message alone when no title is given", async () => {
    const { getByTestId, queryByText } = await render(
      <BetaNotice message="Seulement le message" />,
    );

    expect(getByTestId("beta-notice").props.accessible).toBe(true);
    expect(queryByText("Seulement le message")).toBeTruthy();
  });

  it("uses a neutral tint of the theme primary colour", async () => {
    const { getByTestId } = await render(<BetaNotice message="m" />);

    const flat = StyleSheet.flatten(
      getByTestId("beta-notice").props.style as object,
    ) as Record<string, unknown>;
    expect(flat.backgroundColor).toBe("#0088CE14");
    expect(flat.borderColor).toBe("#0088CE40");
  });
});

describe("BETA_NOTICES copy", () => {
  it("never presents the app as official or endorsed", () => {
    const all = JSON.stringify(BETA_NOTICES).toLowerCase();
    expect(all).not.toMatch(/officielle? de la ffd|endoss|partenaire/);
    expect(all).toContain("pas encore reliée");
  });
});
