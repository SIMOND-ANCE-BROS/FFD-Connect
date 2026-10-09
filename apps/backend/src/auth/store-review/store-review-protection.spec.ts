import { ForbiddenException } from "@nestjs/common";
import {
  assertClubNotStoreReview,
  assertUserNotStoreReview,
  storeReviewClubMessage,
  storeReviewUserMessage,
} from "./store-review-protection";

describe("store-review protection", () => {
  it("uses the French messages shown by the back-office", () => {
    expect(storeReviewUserMessage("delete")).toBe(
      "Ce compte est utilisé pour les validations App Store / Google Play : il ne peut pas être supprimé.",
    );
    expect(storeReviewUserMessage("disable")).toBe(
      "Ce compte est utilisé pour les validations App Store / Google Play : il ne peut pas être désactivé.",
    );
    expect(storeReviewClubMessage("delete")).toBe(
      "Ce club est utilisé pour les validations App Store / Google Play : il ne peut pas être supprimé.",
    );
  });

  it.each(["delete", "disable"] as const)(
    "refuses to %s a flagged user or club with 403",
    (action) => {
      expect(() =>
        assertUserNotStoreReview({ isStoreReview: true }, action),
      ).toThrow(new ForbiddenException(storeReviewUserMessage(action)));
      expect(() =>
        assertClubNotStoreReview({ isStoreReview: true }, action),
      ).toThrow(new ForbiddenException(storeReviewClubMessage(action)));
    },
  );

  it.each([
    { isStoreReview: false },
    { isStoreReview: null },
    {},
    null,
    undefined,
  ])("lets a regular row (%p) through", (row) => {
    expect(() => assertUserNotStoreReview(row, "delete")).not.toThrow();
    expect(() => assertClubNotStoreReview(row, "disable")).not.toThrow();
  });
});
