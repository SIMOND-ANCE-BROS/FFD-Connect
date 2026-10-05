import { BadRequestException } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { PrismaClient } from "@prisma/client";
import { DeepMockProxy, mockDeep } from "jest-mock-extended";
import { PaymentService } from "./payment.service";
import { HelloAssoService } from "./hello-asso.service";
import { ClubsHelloAssoService } from "../clubs/clubs-helloasso.service";
import { PrismaService } from "../prisma/prisma.service";

describe("PaymentService", () => {
  let service: PaymentService;
  let prisma: DeepMockProxy<PrismaClient>;
  let helloAssoService: jest.Mocked<
    Pick<HelloAssoService, "createCheckoutIntent">
  >;
  let clubsService: jest.Mocked<
    Pick<ClubsHelloAssoService, "getHelloAssoCredentialsForCompetition">
  >;
  let configService: jest.Mocked<Pick<ConfigService, "get">>;

  const mockCredentials = {
    clientId: "client-id",
    clientSecret: "client-secret",
    organizationSlug: "org-slug",
  };

  const mockUser = {
    id: "user-1",
    email: "user@example.com",
    firstName: "John",
    lastName: "Doe",
  };

  const mockBooking = {
    id: "booking-1",
    competitionId: "comp-1",
    userId: "user-1",
    itemId: "item-1",
    seatLabel: "A1",
    status: "PENDING",
    expiresAt: new Date(),
    paymentId: null,
  };

  const mockIntent = {
    id: "intent-1",
    redirectUrl: "https://helloasso.com/checkout/intent-1",
  };

  const mockDto = {
    competitionId: "comp-1",
    itemId: "item-1",
    seatLabel: "A1",
    amount: 1500,
  };

  beforeEach(async () => {
    prisma = mockDeep<PrismaClient>();

    helloAssoService = {
      createCheckoutIntent: jest.fn(),
    };

    clubsService = {
      getHelloAssoCredentialsForCompetition: jest.fn(),
    };

    configService = {
      get: jest.fn().mockReturnValue("https://app.example.com"),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentService,
        { provide: PrismaService, useValue: prisma },
        { provide: HelloAssoService, useValue: helloAssoService },
        { provide: ClubsHelloAssoService, useValue: clubsService },
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    service = module.get<PaymentService>(PaymentService);
  });

  describe("createCheckout", () => {
    it("throws BadRequestException when no HelloAsso credentials found", async () => {
      clubsService.getHelloAssoCredentialsForCompetition.mockResolvedValue(
        null,
      );

      await expect(service.createCheckout("user-1", mockDto)).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.createCheckout("user-1", mockDto)).rejects.toThrow(
        /HelloAsso/,
      );
    });

    it("does not call prisma when credentials are missing", async () => {
      clubsService.getHelloAssoCredentialsForCompetition.mockResolvedValue(
        null,
      );

      await expect(service.createCheckout("user-1", mockDto)).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
    });

    it("throws BadRequestException when user is not found", async () => {
      clubsService.getHelloAssoCredentialsForCompetition.mockResolvedValue(
        mockCredentials,
      );
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.createCheckout("user-1", mockDto)).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.createCheckout("user-1", mockDto)).rejects.toThrow(
        "User not found",
      );
    });

    it("does not create booking when user is not found", async () => {
      clubsService.getHelloAssoCredentialsForCompetition.mockResolvedValue(
        mockCredentials,
      );
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.createCheckout("user-1", mockDto)).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.seatBooking.create).not.toHaveBeenCalled();
    });

    it("creates a PENDING booking with correct data", async () => {
      clubsService.getHelloAssoCredentialsForCompetition.mockResolvedValue(
        mockCredentials,
      );
      prisma.user.findUnique.mockResolvedValue(mockUser as any);
      prisma.seatBooking.create.mockResolvedValue(mockBooking as any);
      helloAssoService.createCheckoutIntent.mockResolvedValue(mockIntent);
      prisma.seatBooking.update.mockResolvedValue({
        ...mockBooking,
        paymentId: "intent-1",
      } as any);

      await service.createCheckout("user-1", mockDto);

      expect(prisma.seatBooking.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            competitionId: mockDto.competitionId,
            userId: mockUser.id,
            itemId: mockDto.itemId,
            seatLabel: mockDto.seatLabel,
            status: "PENDING",
          }),
        }),
      );
    });

    it("calls HelloAsso createCheckoutIntent with correct params", async () => {
      clubsService.getHelloAssoCredentialsForCompetition.mockResolvedValue(
        mockCredentials,
      );
      prisma.user.findUnique.mockResolvedValue(mockUser as any);
      prisma.seatBooking.create.mockResolvedValue(mockBooking as any);
      helloAssoService.createCheckoutIntent.mockResolvedValue(mockIntent);
      prisma.seatBooking.update.mockResolvedValue({
        ...mockBooking,
        paymentId: "intent-1",
      } as any);

      await service.createCheckout("user-1", mockDto);

      expect(helloAssoService.createCheckoutIntent).toHaveBeenCalledWith(
        mockCredentials,
        expect.any(String),
        expect.objectContaining({
          amount: mockDto.amount,
          consumerEmail: mockUser.email,
          consumerFirstName: mockUser.firstName,
          consumerLastName: mockUser.lastName,
          metadata: expect.objectContaining({
            bookingId: mockBooking.id,
            competitionId: mockDto.competitionId,
          }),
        }),
      );
    });

    it("updates booking paymentId after successful HelloAsso intent creation", async () => {
      clubsService.getHelloAssoCredentialsForCompetition.mockResolvedValue(
        mockCredentials,
      );
      prisma.user.findUnique.mockResolvedValue(mockUser as any);
      prisma.seatBooking.create.mockResolvedValue(mockBooking as any);
      helloAssoService.createCheckoutIntent.mockResolvedValue(mockIntent);
      prisma.seatBooking.update.mockResolvedValue({
        ...mockBooking,
        paymentId: mockIntent.id,
      } as any);

      await service.createCheckout("user-1", mockDto);

      expect(prisma.seatBooking.update).toHaveBeenCalledWith({
        where: { id: mockBooking.id },
        data: { paymentId: mockIntent.id },
      });
    });

    it("returns the checkout intent on success", async () => {
      clubsService.getHelloAssoCredentialsForCompetition.mockResolvedValue(
        mockCredentials,
      );
      prisma.user.findUnique.mockResolvedValue(mockUser as any);
      prisma.seatBooking.create.mockResolvedValue(mockBooking as any);
      helloAssoService.createCheckoutIntent.mockResolvedValue(mockIntent);
      prisma.seatBooking.update.mockResolvedValue({
        ...mockBooking,
        paymentId: mockIntent.id,
      } as any);

      const result = await service.createCheckout("user-1", mockDto);

      expect(result).toEqual(mockIntent);
    });

    it("deletes booking when HelloAsso createCheckoutIntent throws", async () => {
      clubsService.getHelloAssoCredentialsForCompetition.mockResolvedValue(
        mockCredentials,
      );
      prisma.user.findUnique.mockResolvedValue(mockUser as any);
      prisma.seatBooking.create.mockResolvedValue(mockBooking as any);
      helloAssoService.createCheckoutIntent.mockRejectedValue(
        new Error("HelloAsso API error"),
      );
      prisma.seatBooking.delete.mockResolvedValue(mockBooking as any);

      await expect(service.createCheckout("user-1", mockDto)).rejects.toThrow(
        BadRequestException,
      );

      expect(prisma.seatBooking.delete).toHaveBeenCalledWith({
        where: { id: mockBooking.id },
      });
    });

    it("throws BadRequestException when HelloAsso fails", async () => {
      clubsService.getHelloAssoCredentialsForCompetition.mockResolvedValue(
        mockCredentials,
      );
      prisma.user.findUnique.mockResolvedValue(mockUser as any);
      prisma.seatBooking.create.mockResolvedValue(mockBooking as any);
      helloAssoService.createCheckoutIntent.mockRejectedValue(
        new Error("Network error"),
      );
      prisma.seatBooking.delete.mockResolvedValue(mockBooking as any);

      await expect(service.createCheckout("user-1", mockDto)).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.createCheckout("user-1", mockDto)).rejects.toThrow(
        /paiement/,
      );
    });

    it("does not throw even if booking deletion fails during cleanup", async () => {
      clubsService.getHelloAssoCredentialsForCompetition.mockResolvedValue(
        mockCredentials,
      );
      prisma.user.findUnique.mockResolvedValue(mockUser as any);
      prisma.seatBooking.create.mockResolvedValue(mockBooking as any);
      helloAssoService.createCheckoutIntent.mockRejectedValue(
        new Error("HelloAsso error"),
      );
      // Simulate deletion also failing — the service should swallow this
      prisma.seatBooking.delete.mockRejectedValue(new Error("DB error"));

      await expect(service.createCheckout("user-1", mockDto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it("propagates error when seatBooking.create throws", async () => {
      clubsService.getHelloAssoCredentialsForCompetition.mockResolvedValue(
        mockCredentials,
      );
      prisma.user.findUnique.mockResolvedValue(mockUser as any);
      prisma.seatBooking.create.mockRejectedValue(new Error("DB write error"));

      await expect(service.createCheckout("user-1", mockDto)).rejects.toThrow(
        "DB write error",
      );
      expect(helloAssoService.createCheckoutIntent).not.toHaveBeenCalled();
    });

    it("uses fallback APP_URL when configService returns undefined", async () => {
      configService.get.mockReturnValue(undefined);
      clubsService.getHelloAssoCredentialsForCompetition.mockResolvedValue(
        mockCredentials,
      );
      prisma.user.findUnique.mockResolvedValue(mockUser as any);
      prisma.seatBooking.create.mockResolvedValue(mockBooking as any);
      helloAssoService.createCheckoutIntent.mockResolvedValue(mockIntent);
      prisma.seatBooking.update.mockResolvedValue({
        ...mockBooking,
        paymentId: mockIntent.id,
      } as any);

      const result = await service.createCheckout("user-1", mockDto);

      expect(result).toEqual(mockIntent);
      expect(helloAssoService.createCheckoutIntent).toHaveBeenCalledWith(
        mockCredentials,
        "https://app.example.com",
        expect.any(Object),
      );
    });

    it("uses seatLabel in the intent label when provided", async () => {
      clubsService.getHelloAssoCredentialsForCompetition.mockResolvedValue(
        mockCredentials,
      );
      prisma.user.findUnique.mockResolvedValue(mockUser as any);
      prisma.seatBooking.create.mockResolvedValue(mockBooking as any);
      helloAssoService.createCheckoutIntent.mockResolvedValue(mockIntent);
      prisma.seatBooking.update.mockResolvedValue({
        ...mockBooking,
        paymentId: mockIntent.id,
      } as any);

      await service.createCheckout("user-1", { ...mockDto, seatLabel: "B3" });

      expect(helloAssoService.createCheckoutIntent).toHaveBeenCalledWith(
        mockCredentials,
        expect.any(String),
        expect.objectContaining({ label: "Place Compétition - B3" }),
      );
    });

    it("falls back to itemId in label when seatLabel is not provided", async () => {
      const dtoWithoutSeatLabel = {
        competitionId: "comp-1",
        itemId: "item-1",
        amount: 1500,
      };
      const bookingWithoutSeatLabel = { ...mockBooking, seatLabel: null };

      clubsService.getHelloAssoCredentialsForCompetition.mockResolvedValue(
        mockCredentials,
      );
      prisma.user.findUnique.mockResolvedValue(mockUser as any);
      prisma.seatBooking.create.mockResolvedValue(
        bookingWithoutSeatLabel as any,
      );
      helloAssoService.createCheckoutIntent.mockResolvedValue(mockIntent);
      prisma.seatBooking.update.mockResolvedValue({
        ...bookingWithoutSeatLabel,
        paymentId: mockIntent.id,
      } as any);

      await service.createCheckout("user-1", dtoWithoutSeatLabel);

      expect(helloAssoService.createCheckoutIntent).toHaveBeenCalledWith(
        mockCredentials,
        expect.any(String),
        expect.objectContaining({ label: "Place Compétition - item-1" }),
      );
    });
  });

  describe("confirmBooking", () => {
    it("calls seatBooking.update with CONFIRMED status", async () => {
      prisma.seatBooking.update.mockResolvedValue({
        ...mockBooking,
        status: "CONFIRMED",
      } as any);

      await service.confirmBooking("booking-1");

      expect(prisma.seatBooking.update).toHaveBeenCalledWith({
        where: { id: "booking-1" },
        data: { status: "CONFIRMED" },
      });
    });

    it("propagates prisma errors", async () => {
      prisma.seatBooking.update.mockRejectedValue(new Error("DB error"));

      await expect(service.confirmBooking("booking-1")).rejects.toThrow(
        "DB error",
      );
    });
  });
});
