import { fireEvent, render } from "@testing-library/react-native";
import React from "react";

import { ThemeContext } from "../../../../context/ThemeContext";
import {
  RENEWAL_UNDER_REVIEW_TITLE,
  RenewalUnderReviewBanner,
} from "../RenewalUnderReviewBanner";

const themeMock = {
  theme: {
    primary: "#004fe3",
    textSecondary: "#666666",
    typography: {
      fontFamily: "System",
      body: { fontSize: 14, fontFamily: "System" },
      caption: { fontSize: 12, fontFamily: "System" },
    },
  },
  isDark: false,
};

describe("RenewalUnderReviewBanner (#268)", () => {
  it("says the request is being checked and opens the renewal on tap", async () => {
    const onPress = jest.fn();
    const { getByText, getByTestId } = await render(
      <ThemeContext.Provider value={themeMock as never}>
        <RenewalUnderReviewBanner onPress={onPress} />
      </ThemeContext.Provider>,
    );

    expect(getByText(RENEWAL_UNDER_REVIEW_TITLE)).toBeTruthy();
    expect(RENEWAL_UNDER_REVIEW_TITLE).toMatch(/en cours de vérification/);
    await fireEvent.press(getByTestId("renewal-under-review-banner"));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
