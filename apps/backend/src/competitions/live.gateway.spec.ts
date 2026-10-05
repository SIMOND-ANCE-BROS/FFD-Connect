import { JwtService } from "@nestjs/jwt";
import { Socket } from "socket.io";
import { Server } from "socket.io";
import { LiveGateway } from "./live.gateway";

const mockJwtService = {
  verify: jest.fn().mockReturnValue({ sub: "user-1" }),
} as unknown as JwtService;

describe("LiveGateway", () => {
  let gateway: LiveGateway;

  beforeEach(() => {
    gateway = new LiveGateway(mockJwtService);
    (
      gateway as unknown as { logger: { log: jest.Mock; warn: jest.Mock } }
    ).logger = { log: jest.fn(), warn: jest.fn() };
  });

  describe("handleConnection", () => {
    it("should allow connection with valid token in auth", () => {
      const client = {
        id: "c1",
        handshake: { auth: { token: "valid" }, headers: {} },
        disconnect: jest.fn(),
      };
      (mockJwtService.verify as jest.Mock).mockReturnValueOnce({
        sub: "user-1",
      });
      gateway.handleConnection(client as unknown as Socket);
      expect(client.disconnect).not.toHaveBeenCalled();
    });

    it("should allow connection with valid Bearer token in headers", () => {
      const client = {
        id: "c2",
        handshake: {
          auth: {},
          headers: { authorization: "Bearer valid-token" },
        },
        disconnect: jest.fn(),
      };
      (mockJwtService.verify as jest.Mock).mockReturnValueOnce({
        sub: "user-1",
      });
      gateway.handleConnection(client as unknown as Socket);
      expect(client.disconnect).not.toHaveBeenCalled();
    });

    it("should disconnect client with no token", () => {
      const client = {
        id: "c3",
        handshake: { auth: {}, headers: {} },
        disconnect: jest.fn(),
      };
      gateway.handleConnection(client as unknown as Socket);
      expect(client.disconnect).toHaveBeenCalledWith(true);
    });

    it("should disconnect client with invalid token", () => {
      const client = {
        id: "c4",
        handshake: { auth: { token: "bad" }, headers: {} },
        disconnect: jest.fn(),
      };
      (mockJwtService.verify as jest.Mock).mockImplementationOnce(() => {
        throw new Error("invalid");
      });
      gateway.handleConnection(client as unknown as Socket);
      expect(client.disconnect).toHaveBeenCalledWith(true);
    });
  });

  describe("handleJoinCompetition", () => {
    it("should join competition room and return event payload", async () => {
      const client = {
        id: "client-1",
        join: jest.fn().mockResolvedValue(undefined),
      };

      const result = await gateway.handleJoinCompetition(
        client as unknown as Socket,
        "comp-1",
      );

      expect(client.join).toHaveBeenCalledWith("competition_comp-1");
      expect(result).toEqual({ event: "joined", data: "comp-1" });
    });
  });

  describe("handleLeaveCompetition", () => {
    it("should leave competition room and return event payload", async () => {
      const client = {
        id: "client-1",
        leave: jest.fn().mockResolvedValue(undefined),
      };

      const result = await gateway.handleLeaveCompetition(
        client as unknown as Socket,
        "comp-1",
      );

      expect(client.leave).toHaveBeenCalledWith("competition_comp-1");
      expect(result).toEqual({ event: "left", data: "comp-1" });
    });
  });

  describe("broadcast helpers", () => {
    it("should broadcast heat updates to room", () => {
      const emit = jest.fn();
      const to = jest.fn().mockReturnValue({ emit });
      gateway.server = { to } as unknown as Server;

      const heatData = {
        competitionId: "comp-1",
        eventId: "event-1",
        heatNumber: 1,
      };
      gateway.broadcastHeatUpdate("comp-1", heatData);

      expect(to).toHaveBeenCalledWith("competition_comp-1");
      expect(emit).toHaveBeenCalledWith("heat_update", heatData);
    });

    it("should broadcast delay updates to room", () => {
      const emit = jest.fn();
      const to = jest.fn().mockReturnValue({ emit });
      gateway.server = { to } as unknown as Server;

      gateway.broadcastDelayUpdate("comp-1", 15);

      expect(to).toHaveBeenCalledWith("competition_comp-1");
      expect(emit).toHaveBeenCalledWith("delay_update", {
        competitionId: "comp-1",
        delayMinutes: 15,
      });
    });

    it("should broadcast result publication to room", () => {
      const emit = jest.fn();
      const to = jest.fn().mockReturnValue({ emit });
      gateway.server = { to } as unknown as Server;

      const resultData = {
        competitionId: "comp-1",
        eventId: "event-1",
        results: [{ userId: "user-1", ranking: 1 }],
      };
      gateway.broadcastResultPublished("comp-1", resultData);

      expect(to).toHaveBeenCalledWith("competition_comp-1");
      expect(emit).toHaveBeenCalledWith("result_published", resultData);
    });
  });
});
