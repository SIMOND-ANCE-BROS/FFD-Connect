import {
  clubMemberNotificationBody,
  coupleNotificationLabel,
} from "../notifications/member-name-copy";
import {
  DELETED_MEMBER_LABEL,
  DELETED_MEMBER_NOTIFICATION_BODY,
  scrubClubMemberNotificationBody,
  scrubCoupleNotificationBody,
  withoutDeletedMemberIds,
} from "./notification-name-scrub.utils";

// Fictitious names only.
describe("scrubClubMemberNotificationBody (#423)", () => {
  it.each([
    "club_member_auto_registered",
    "club_member_pending_registration",
    "club_member_unregistered",
  ] as const)(
    "replaces the member's name of a %s body, keeping the rest",
    (type) => {
      const body = clubMemberNotificationBody(
        type,
        "Alex MARTIN",
        "Open de Paris",
        "Latines Adulte",
      );
      const scrubbed = scrubClubMemberNotificationBody(body, type);
      expect(scrubbed).toBe(
        clubMemberNotificationBody(
          type,
          DELETED_MEMBER_LABEL,
          "Open de Paris",
          "Latines Adulte",
        ),
      );
      expect(scrubbed).not.toContain("MARTIN");
    },
  );

  it("does not rely on the current name: a name changed since is replaced too", () => {
    // The structural link already chose the row; the format locates the name.
    const body = clubMemberNotificationBody(
      "club_member_unregistered",
      "Alexandra MARTIN-DURAND",
      "Open",
      "Standard",
    );
    expect(
      scrubClubMemberNotificationBody(body, "club_member_unregistered"),
    ).toBe(`${DELETED_MEMBER_LABEL} s'est désinscrit de "Open" - Standard.`);
  });

  it("leaves a body that names nobody untouched", () => {
    const body = clubMemberNotificationBody(
      "club_member_auto_registered",
      "Un licencié",
      "Open",
      "Standard",
    );
    expect(
      scrubClubMemberNotificationBody(body, "club_member_auto_registered"),
    ).toBeNull();
  });

  it("is idempotent", () => {
    const body = clubMemberNotificationBody(
      "club_member_auto_registered",
      DELETED_MEMBER_LABEL,
      "Open",
      "Standard",
    );
    expect(
      scrubClubMemberNotificationBody(body, "club_member_auto_registered"),
    ).toBeNull();
  });

  it("falls back to a neutral body when the format is not recognised", () => {
    expect(
      scrubClubMemberNotificationBody(
        "Alex MARTIN a fait autre chose",
        "club_member_auto_registered",
      ),
    ).toBe(DELETED_MEMBER_NOTIFICATION_BODY);
  });
});

describe("scrubCoupleNotificationBody (#423)", () => {
  const body = `${coupleNotificationLabel(
    { firstName: "Alex", lastName: "MARTIN" },
    { firstName: "Sam", lastName: "PETIT" },
  )} : le couple inter-club a été clôturé par l'autre club.`;

  it("replaces the first member's half", () => {
    expect(scrubCoupleNotificationBody(body, 0)).toBe(
      "Partenaire supprimé & Sam PETIT : le couple inter-club a été clôturé par l'autre club.",
    );
  });

  it("replaces the second member's half", () => {
    expect(scrubCoupleNotificationBody(body, 1)).toBe(
      "Alex MARTIN & Partenaire supprimé : le couple inter-club a été clôturé par l'autre club.",
    );
  });

  it("keeps the rest of a multi-line body, colons included", () => {
    const multi =
      "Alex MARTIN & Sam PETIT : votre club est invité.\nMode : co-gestion.";
    expect(scrubCoupleNotificationBody(multi, 1)).toBe(
      "Alex MARTIN & Partenaire supprimé : votre club est invité.\nMode : co-gestion.",
    );
  });

  it("scrubs the second member after the first one was already scrubbed", () => {
    const once = scrubCoupleNotificationBody(body, 0)!;
    expect(scrubCoupleNotificationBody(once, 1)).toBe(
      "Partenaire supprimé & Partenaire supprimé : le couple inter-club a été clôturé par l'autre club.",
    );
  });

  it("is idempotent and leaves an anonymous couple label untouched", () => {
    expect(
      scrubCoupleNotificationBody(scrubCoupleNotificationBody(body, 0)!, 0),
    ).toBeNull();
    expect(scrubCoupleNotificationBody("Un couple : clôturé.", 0)).toBeNull();
  });

  it("replaces the whole label when it does not split in two halves", () => {
    expect(scrubCoupleNotificationBody("Alex & Sam & Noa : clôturé.", 0)).toBe(
      "Un couple : clôturé.",
    );
  });

  it("falls back to a neutral body without a label", () => {
    expect(scrubCoupleNotificationBody("Alex MARTIN & Sam PETIT", 0)).toBe(
      DELETED_MEMBER_NOTIFICATION_BODY,
    );
  });
});

describe("withoutDeletedMemberIds (#423)", () => {
  it("drops the member keys that point to the deleted user", () => {
    expect(
      withoutDeletedMemberIds(
        {
          type: "partnership_interclub_ended",
          partnershipId: "p1",
          member1UserId: "deleted",
          member2UserId: "u2",
        },
        "deleted",
      ),
    ).toEqual({
      type: "partnership_interclub_ended",
      partnershipId: "p1",
      member2UserId: "u2",
    });
  });

  it("returns null when nothing points to the deleted user", () => {
    expect(
      withoutDeletedMemberIds({ type: "x", member1UserId: "u2" }, "deleted"),
    ).toBeNull();
    expect(withoutDeletedMemberIds(null, "deleted")).toBeNull();
    expect(withoutDeletedMemberIds(["deleted"], "deleted")).toBeNull();
  });
});
