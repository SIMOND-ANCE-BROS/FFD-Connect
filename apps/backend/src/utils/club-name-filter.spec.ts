import { escapeLikePattern, sameClubName } from "./club-name-filter";

describe("club-name-filter (#625)", () => {
  it("escapes the LIKE wildcards and the escape character", () => {
    expect(escapeLikePattern("Club_A 100% \\ danse")).toBe(
      "Club\\_A 100\\% \\\\ danse",
    );
  });

  it("leaves a plain name unchanged", () => {
    expect(escapeLikePattern("Club Élite Paris")).toBe("Club Élite Paris");
  });

  it("builds a case-insensitive equality on the escaped name", () => {
    expect(sameClubName("A_B%")).toEqual({
      equals: "A\\_B\\%",
      mode: "insensitive",
    });
  });
});
