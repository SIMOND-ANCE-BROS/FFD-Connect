import { fireEvent, render, screen } from "@testing-library/react-native";
import React from "react";
import type { AppTheme } from "../../../../../context/ThemeContext";
import type { Partnership } from "../../../services/ClubService";
import { CoupleCard } from "../CoupleCard";

jest.mock("../../../../../components/AppText");

const theme = {
  surface: "#fff",
  text: "#111",
  textSecondary: "#666",
  primary: "#004481",
} as unknown as AppTheme;

const partnership = {
  id: "p1",
  status: "ACTIVE",
  startDate: "2026-01-15T00:00:00.000Z",
  endDate: null,
  user1Id: "u1",
  user2Id: "u2",
  user1: { firstName: "Jean", lastName: "Dupont" },
  user2: { firstName: "Léa", lastName: "Martin" },
  secondaryClubId: null,
  secondaryClub: null,
} as unknown as Partnership;

describe("CoupleCard — screen reader (#22)", () => {
  it("reads the couple as one sentence and names the end action with it", async () => {
    const onEnd = jest.fn();
    await render(
      <CoupleCard
        theme={theme}
        item={partnership}
        activeOnly
        myClubId="c1"
        onEnd={onEnd}
        onValidate={jest.fn()}
      />,
    );

    expect(
      screen.getByLabelText(
        "Jean Dupont et Léa Martin, depuis le 15 janvier 2026",
      ),
    ).toBeTruthy();
    await fireEvent.press(
      screen.getByRole("button", {
        name: "Clôturer le partenariat de Jean Dupont et Léa Martin",
      }),
    );
    expect(onEnd).toHaveBeenCalledWith(partnership);
  });

  it("names the inter-club validation actions and the pending state", async () => {
    const onValidate = jest.fn();
    await render(
      <CoupleCard
        theme={theme}
        item={
          {
            ...partnership,
            status: "PENDING_SECOND_CLUB",
            secondaryClubId: "c1",
            secondaryClub: { id: "c1", name: "Club B" },
          } as unknown as Partnership
        }
        activeOnly
        myClubId="c1"
        onEnd={jest.fn()}
        onValidate={onValidate}
      />,
    );

    expect(
      screen.getByLabelText(
        /avec Club B, en attente de validation du club partenaire$/,
      ),
    ).toBeTruthy();
    await fireEvent.press(
      screen.getByRole("button", {
        name: "Refuser le partenariat de Jean Dupont et Léa Martin",
      }),
    );
    expect(onValidate).toHaveBeenCalledWith("p1", false);
  });
});
