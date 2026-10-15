/**
 * Programme of the club competition editor (#442) through the generated
 * OpenAPI client: GET / PUT /competitions/:id/program.
 */
import {
  competitionsControllerGetProgram,
  competitionsControllerReplaceProgram,
} from "../../../../api/generated/sdk.gen";
import {
  CompetitionProgramError,
  fetchCompetitionProgram,
  saveCompetitionProgram,
} from "../competitionProgramApi";

jest.mock("../../../../api/client", () => ({}));
jest.mock("../../../../api/generated/sdk.gen", () => ({
  competitionsControllerGetProgram: jest.fn(),
  competitionsControllerReplaceProgram: jest.fn(),
}));

const getMock = competitionsControllerGetProgram as jest.Mock;
const putMock = competitionsControllerReplaceProgram as jest.Mock;

const program = {
  competitionId: "comp-1",
  syncedFromFfd: false,
  eventsSource: null,
  programEditedAt: null,
  events: [],
  schedule: [],
};
const body = { events: [], schedule: [] };

describe("competitionProgramApi (#442)", () => {
  beforeEach(() => jest.clearAllMocks());

  it("fetches the programme of a competition", async () => {
    getMock.mockResolvedValue({ data: program });

    await expect(fetchCompetitionProgram("comp-1")).resolves.toBe(program);
    expect(getMock).toHaveBeenCalledWith({ path: { id: "comp-1" } });
  });

  it("fails with a French message when it cannot be fetched", async () => {
    getMock.mockResolvedValue({
      error: { message: "Forbidden" },
      response: { status: 403 },
    });

    const attempt = fetchCompetitionProgram("comp-1");
    await expect(attempt).rejects.toBeInstanceOf(CompetitionProgramError);
    await expect(attempt).rejects.toThrow(
      "Impossible de charger les épreuves et le planning",
    );
  });

  it("saves the programme and returns the stored one", async () => {
    putMock.mockResolvedValue({ data: program });

    await expect(saveCompetitionProgram("comp-1", body)).resolves.toBe(program);
    expect(putMock).toHaveBeenCalledWith({ path: { id: "comp-1" }, body });
  });

  it("passes on the server's explanation of a refused programme (409)", async () => {
    putMock.mockResolvedValue({
      error: {
        statusCode: 409,
        message:
          "Impossible de retirer l'épreuve « Latines Adulte » : des inscriptions ou des résultats y sont rattachés.",
      },
      response: { status: 409 },
    });

    await expect(saveCompetitionProgram("comp-1", body)).rejects.toMatchObject({
      message: expect.stringContaining("« Latines Adulte »") as unknown,
      status: 409,
    });
  });

  it("takes the first validation message of a 400", async () => {
    putMock.mockResolvedValue({
      error: { message: ["schedule.0.startTime doit être au format HH:MM"] },
      response: { status: 400 },
    });

    await expect(saveCompetitionProgram("comp-1", body)).rejects.toThrow(
      "schedule.0.startTime doit être au format HH:MM",
    );
  });

  it.each([
    ["a server error", { message: "boom" }, 500],
    ["an unreadable 400", "Bad Request", 400],
    ["a 409 without message", { statusCode: 409 }, 409],
  ])("falls back to a generic message on %s", async (_label, error, status) => {
    putMock.mockResolvedValue({ error, response: { status } });

    await expect(saveCompetitionProgram("comp-1", body)).rejects.toThrow(
      "Impossible d'enregistrer les épreuves et le planning",
    );
  });
});
