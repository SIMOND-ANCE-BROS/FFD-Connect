import { Test, TestingModule } from "@nestjs/testing";
import { NotificationType, RegistrationStatus } from "@prisma/client";
import { NotificationsService } from "../../notifications/notifications.service";
import { PrismaService } from "../../prisma/prisma.service";
import { createMockPrismaService } from "../__mocks__/types";
import { RegistrationNotificationService } from "./registration-notification.service";

const mockPrismaService = createMockPrismaService();
const mockNotificationsService = {
  createForUser: jest.fn().mockResolvedValue(undefined),
  sendToUser: jest.fn().mockResolvedValue({ sent: 0, failed: 0, pruned: 0 }),
};

describe("RegistrationNotificationService", () => {
  let service: RegistrationNotificationService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RegistrationNotificationService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
        {
          provide: NotificationsService,
          useValue: mockNotificationsService,
        },
      ],
    }).compile();

    service = module.get<RegistrationNotificationService>(
      RegistrationNotificationService,
    );
    jest.clearAllMocks();
  });

  describe("notifyOnRegister", () => {
    it("sends inscription-by-club notification when byOrganizer is true", async () => {
      await service.notifyOnRegister(
        { id: "r1", userId: "u1" },
        {
          competitionId: "c1",
          id: "e1",
          competition: { title: "Comp" },
          category: "Latin",
          ageGroup: "Adulte",
        },
        null,
        { byOrganizer: true, initialStatus: RegistrationStatus.CONFIRMED },
      );

      expect(mockNotificationsService.createForUser).toHaveBeenCalledWith(
        "u1",
        NotificationType.REGISTRATION_STATUS,
        "Inscription par le club",
        expect.stringContaining("Comp"),
        expect.objectContaining({ type: "registration_by_club" }),
      );
    });

    it("sends auto-confirmed notification and notifies club organizers when MEMBERS_AUTO_CONFIRM", async () => {
      mockPrismaService.user.findMany.mockResolvedValue([{ id: "org-1" }]);

      await service.notifyOnRegister(
        { id: "r1", userId: "u1" },
        {
          competitionId: "c1",
          id: "e1",
          competition: { title: "Comp" },
          category: "Latin",
          ageGroup: "Adulte",
        },
        {
          firstName: "Jean",
          lastName: "Dupont",
          clubId: "club-1",
          clubName: null,
        },
        { byOrganizer: false, initialStatus: RegistrationStatus.CONFIRMED },
      );

      expect(mockNotificationsService.createForUser).toHaveBeenCalledWith(
        "u1",
        NotificationType.REGISTRATION_STATUS,
        "Inscription validée",
        expect.any(String),
        expect.objectContaining({ type: "registration_auto_confirmed" }),
      );
      expect(mockNotificationsService.createForUser).toHaveBeenCalledWith(
        "org-1",
        NotificationType.CLUB_MEMBER_REGISTRATION,
        expect.any(String),
        expect.any(String),
        expect.objectContaining({ type: "club_member_auto_registered" }),
      );
    });

    it("sends pending notification and notifies club organizers when PENDING", async () => {
      mockPrismaService.user.findMany.mockResolvedValue([{ id: "org-2" }]);

      await service.notifyOnRegister(
        { id: "r1", userId: "u1" },
        {
          competitionId: "c1",
          id: "e1",
          competition: { title: "Comp" },
          category: "Latin",
          ageGroup: "Adulte",
        },
        {
          firstName: "Jean",
          lastName: "Dupont",
          clubId: "club-1",
          clubName: null,
        },
        { byOrganizer: false, initialStatus: RegistrationStatus.PENDING },
      );

      expect(mockNotificationsService.createForUser).toHaveBeenCalledWith(
        "u1",
        NotificationType.REGISTRATION_STATUS,
        "Inscription en attente",
        expect.any(String),
        expect.objectContaining({ type: "registration_pending" }),
      );
      expect(mockNotificationsService.createForUser).toHaveBeenCalledWith(
        "org-2",
        NotificationType.CLUB_MEMBER_REGISTRATION,
        expect.any(String),
        expect.any(String),
        expect.objectContaining({ type: "club_member_pending_registration" }),
      );
    });
  });

  describe("notifyOnUnregister", () => {
    it("sends refused-by-club notification when byOrganizer unregisters a PENDING registration", async () => {
      await service.notifyOnUnregister(
        { id: "r1", userId: "u1", status: RegistrationStatus.PENDING },
        {
          competitionId: "c1",
          id: "e1",
          competition: { title: "Comp" },
          category: "Latin",
          ageGroup: "Adulte",
        },
        null,
        { byOrganizer: true, organizerUserId: "org-1" },
      );

      expect(mockNotificationsService.createForUser).toHaveBeenCalledWith(
        "u1",
        NotificationType.REGISTRATION_STATUS,
        "Inscription refusée par le club",
        expect.any(String),
        expect.objectContaining({ type: "registration_refused_by_club" }),
      );
    });

    it("sends unregistration-by-club notification when byOrganizer unregisters a CONFIRMED registration", async () => {
      await service.notifyOnUnregister(
        { id: "r1", userId: "u1", status: RegistrationStatus.CONFIRMED },
        {
          competitionId: "c1",
          id: "e1",
          competition: { title: "Comp" },
          category: "Latin",
          ageGroup: "Adulte",
        },
        null,
        { byOrganizer: true, organizerUserId: "org-1" },
      );

      expect(mockNotificationsService.createForUser).toHaveBeenCalledWith(
        "u1",
        NotificationType.REGISTRATION_STATUS,
        "Désinscription par le club",
        expect.any(String),
        expect.objectContaining({ type: "unregistration_by_club" }),
      );
    });

    it("notifies club organizers when member self-unregisters and has clubId", async () => {
      mockPrismaService.user.findMany.mockResolvedValue([{ id: "org-1" }]);

      await service.notifyOnUnregister(
        { id: "r1", userId: "u1", status: RegistrationStatus.CONFIRMED },
        {
          competitionId: "c1",
          id: "e1",
          competition: { title: "Comp" },
          category: "Latin",
          ageGroup: "Adulte",
        },
        {
          firstName: "Jean",
          lastName: "Dupont",
          clubId: "club-1",
          clubName: null,
        },
        { byOrganizer: false },
      );

      expect(mockNotificationsService.createForUser).toHaveBeenCalledWith(
        "org-1",
        NotificationType.CLUB_MEMBER_REGISTRATION,
        expect.any(String),
        expect.any(String),
        expect.objectContaining({ type: "club_member_unregistered" }),
      );
    });
  });

  describe("notifyOnConfirm", () => {
    const event = {
      competitionId: "c1",
      id: "e1",
      competition: { title: "Comp" },
      category: "Latin",
      ageGroup: "Adulte",
    };

    // Seul producteur branché sur le push : c'est le moment où la notification
    // a le plus de valeur hors de l'app (le licencié attend la décision de son
    // club). Les autres producteurs restent sur createForUser (feed seul).
    it("envoie un push ET alimente le feed via sendToUser", async () => {
      await service.notifyOnConfirm(
        { id: "r1", userId: "u1", eventId: "e1" },
        event,
      );

      expect(mockNotificationsService.sendToUser).toHaveBeenCalledWith(
        "u1",
        NotificationType.REGISTRATION_STATUS,
        "Inscription validée par le club",
        expect.stringContaining("Comp"),
        expect.objectContaining({ type: "registration_confirmed_by_club" }),
      );
      // Le feed in-app est écrit par sendToUser : pas de double écriture.
      expect(mockNotificationsService.createForUser).not.toHaveBeenCalled();
    });

    it("n'écrit pas deux fois la notification (un seul appel sortant)", async () => {
      await service.notifyOnConfirm(
        { id: "r1", userId: "u1", eventId: "e1" },
        event,
      );

      expect(mockNotificationsService.sendToUser).toHaveBeenCalledTimes(1);
    });
  });
});
