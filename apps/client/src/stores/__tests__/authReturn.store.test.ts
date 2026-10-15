import { useAuthReturnStore } from "../authReturn.store";

describe("authReturn.store", () => {
  beforeEach(() => {
    useAuthReturnStore.setState({ target: null });
  });

  it("starts with no pending return", () => {
    expect(useAuthReturnStore.getState().target).toBeNull();
  });

  it("remembers the screen and its params", () => {
    useAuthReturnStore.getState().setTarget({
      screen: "CompetitionDetail",
      params: { competitionId: "comp-1" },
    });
    expect(useAuthReturnStore.getState().target).toEqual({
      screen: "CompetitionDetail",
      params: { competitionId: "comp-1" },
    });
  });

  it("keeps only the latest target", () => {
    const { setTarget } = useAuthReturnStore.getState();
    setTarget({ screen: "CompetitionDetail", params: { competitionId: "a" } });
    setTarget({ screen: "CompetitionDetail", params: { competitionId: "b" } });
    expect(useAuthReturnStore.getState().target).toEqual({
      screen: "CompetitionDetail",
      params: { competitionId: "b" },
    });
  });

  it("clear() forgets the pending return", () => {
    useAuthReturnStore.getState().setTarget({
      screen: "CompetitionDetail",
      params: { competitionId: "comp-1" },
    });
    useAuthReturnStore.getState().clear();
    expect(useAuthReturnStore.getState().target).toBeNull();
  });
});
