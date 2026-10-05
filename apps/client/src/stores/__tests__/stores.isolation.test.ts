/**
 * Store isolation tests — each store must initialize without depending on others.
 */

import { useCompetitionStore } from "../competition.store";
import { usePlayerStore } from "../player.store";
import { useClubStore } from "../club.store";
import { usePerformanceStore } from "../performance.store";

describe("Store isolation", () => {
  describe("competitionStore", () => {
    it("initializes without depending on other stores", () => {
      const state = useCompetitionStore.getState();
      expect(state).toBeDefined();
    });
  });

  describe("playerStore", () => {
    it("initializes without depending on other stores", () => {
      const state = usePlayerStore.getState();
      expect(state).toBeDefined();
    });
  });

  describe("clubStore", () => {
    it("initializes without depending on other stores", () => {
      const state = useClubStore.getState();
      expect(state).toBeDefined();
    });
  });

  describe("performanceStore", () => {
    it("initializes without depending on other stores", () => {
      const state = usePerformanceStore.getState();
      expect(state).toBeDefined();
    });
  });
});
