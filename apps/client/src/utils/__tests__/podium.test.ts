import { theme } from "../../theme";
import { getPodiumStyle, isPodiumRank } from "../podium";

const PRIMARY = "#123456";

describe("podium", () => {
  describe("isPodiumRank", () => {
    it.each([1, 2, 3])("returns true for podium rank %i", (rank) => {
      expect(isPodiumRank(rank)).toBe(true);
    });

    it.each([0, 4, 10, -1, 1.5, Number.NaN])(
      "returns false for non-podium rank %p",
      (rank) => {
        expect(isPodiumRank(rank)).toBe(false);
      },
    );
  });

  describe("getPodiumStyle", () => {
    it("maps rank 1 to gold with a dark, AA-legible number", () => {
      const style = getPodiumStyle(1, PRIMARY);
      expect(style.isPodium).toBe(true);
      expect(style.backgroundColor).toBe(theme.colors.gold);
      expect(style.textColor).toBe(theme.colors.slate900);
    });

    it("maps rank 2 to silver", () => {
      const style = getPodiumStyle(2, PRIMARY);
      expect(style.isPodium).toBe(true);
      expect(style.backgroundColor).toBe(theme.colors.silver);
      expect(style.textColor).toBe(theme.colors.slate900);
    });

    it("maps rank 3 to bronze", () => {
      const style = getPodiumStyle(3, PRIMARY);
      expect(style.isPodium).toBe(true);
      expect(style.backgroundColor).toBe(theme.colors.bronze);
      expect(style.textColor).toBe(theme.colors.slate900);
    });

    it.each([4, 5, 10, 42])(
      "keeps the historical primary/white badge off-podium (rank %i)",
      (rank) => {
        const style = getPodiumStyle(rank, PRIMARY);
        expect(style.isPodium).toBe(false);
        expect(style.backgroundColor).toBe(PRIMARY);
        expect(style.textColor).toBe(theme.colors.white);
      },
    );

    it("treats invalid ranks (0, negative, fractional) as off-podium", () => {
      for (const rank of [0, -3, 1.5]) {
        const style = getPodiumStyle(rank, PRIMARY);
        expect(style.isPodium).toBe(false);
        expect(style.backgroundColor).toBe(PRIMARY);
      }
    });

    it("gives each podium rank a distinct colour", () => {
      const colors = [1, 2, 3].map(
        (r) => getPodiumStyle(r, PRIMARY).backgroundColor,
      );
      expect(new Set(colors).size).toBe(3);
    });
  });
});
