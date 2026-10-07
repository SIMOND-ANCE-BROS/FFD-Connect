import { Alert } from "react-native";
import type { MockNotificationMessage } from "../../../../__tests__/mocks/types";
import {
  handleBackgroundMessage,
  notificationHandler,
} from "../NotificationHandler";

let onMessageHandler: ((message: MockNotificationMessage) => void) | null =
  null;
let mockOnOpenedHandler: ((message: MockNotificationMessage) => void) | null =
  null;
let mockInitialNotification: Promise<MockNotificationMessage | null> =
  Promise.resolve(null);

let mockMessaging: jest.Mock;

const mockSetPendingDeepLink = jest.fn();
jest.mock("../../../../stores/auth.store", () => ({
  useAuthStore: {
    getState: () => ({ setPendingDeepLink: mockSetPendingDeepLink }),
  },
}));

jest.mock("@react-native-firebase/messaging", () => {
  mockMessaging = jest.fn(() => ({
    requestPermission: jest.fn(),
    getToken: jest.fn(),
    setBackgroundMessageHandler: jest.fn(),
    onMessage: jest.fn(
      (handler: (message: MockNotificationMessage) => void) => {
        onMessageHandler = handler;
        return jest.fn();
      },
    ),
    onNotificationOpenedApp: jest.fn(
      (handler: (message: MockNotificationMessage) => void) => {
        mockOnOpenedHandler = handler;
        return jest.fn();
      },
    ),
    getInitialNotification: jest.fn(() => mockInitialNotification),
    subscribeToTopic: jest.fn(),
    unsubscribeFromTopic: jest.fn(),
  }));

  mockMessaging.AuthorizationStatus = {
    AUTHORIZED: 1,
    PROVISIONAL: 2,
  };

  return {
    __esModule: true,
    default: mockMessaging,
    AuthorizationStatus: mockMessaging.AuthorizationStatus,
  };
});

describe("NotificationHandler", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    onMessageHandler = null;
  });

  /**
   * Les deux gestionnaires étaient VIDES (#84) : l'application s'abonnait aux
   * événements et n'en faisait rien, si bien qu'un tap sur la push rouvrait
   * l'écran courant et rien d'autre.
   */
  describe("tap sur une push système", () => {
    it("dépose la compétition visée, app en arrière-plan", () => {
      notificationHandler.setupNotificationListeners();

      mockOnOpenedHandler?.({ data: { competitionId: "comp-42" } });

      expect(mockSetPendingDeepLink).toHaveBeenCalledWith({
        screen: "CompetitionDetail",
        params: { competitionId: "comp-42" },
      });
    });

    it("dépose la compétition visée, app lancée depuis l'état fermé", async () => {
      mockInitialNotification = Promise.resolve({
        data: { competitionId: "comp-7" },
      } as MockNotificationMessage);

      notificationHandler.setupNotificationListeners();
      await mockInitialNotification;
      await Promise.resolve();

      expect(mockSetPendingDeepLink).toHaveBeenCalledWith({
        screen: "CompetitionDetail",
        params: { competitionId: "comp-7" },
      });
    });

    // L'utilisateur a tapé : il doit arriver quelque part, ne serait-ce que là
    // où la notification est lisible en entier.
    it("ouvre le centre de notifications quand la charge utile ne désigne rien", () => {
      notificationHandler.setupNotificationListeners();

      mockOnOpenedHandler?.({ data: { type: "test" } });

      expect(mockSetPendingDeepLink).toHaveBeenCalledWith({
        screen: "Notifications",
        params: undefined,
      });
    });

    it("ne dépose rien si l'application n'a pas été lancée par une push", async () => {
      mockInitialNotification = Promise.resolve(null);

      notificationHandler.setupNotificationListeners();
      await mockInitialNotification;
      await Promise.resolve();

      expect(mockSetPendingDeepLink).not.toHaveBeenCalled();
    });
  });

  it("requests permission and returns token when enabled", async () => {
    const instance = mockMessaging();
    mockMessaging.mockReturnValue(instance);
    instance.requestPermission.mockResolvedValue(
      mockMessaging.AuthorizationStatus.AUTHORIZED,
    );
    instance.getToken.mockResolvedValue("token");

    const token = await notificationHandler.requestUserPermission();

    expect(token).toBe("token");
  });

  it("shows alert on foreground notification", async () => {
    jest.spyOn(Alert, "alert").mockImplementation(() => {});
    const instance = mockMessaging();
    mockMessaging.mockReturnValue(instance);
    notificationHandler.setupNotificationListeners();

    expect(onMessageHandler).toBeDefined();
    onMessageHandler?.({
      notification: { title: "Hello", body: "World" },
    });

    expect(Alert.alert).toHaveBeenCalledWith("Hello", "World");
  });

  it("wires the foreground listeners without the background handler (#775)", () => {
    const instance = mockMessaging();
    mockMessaging.mockReturnValue(instance);

    notificationHandler.setupNotificationListeners();

    expect(instance.onMessage).toHaveBeenCalledTimes(1);
    expect(instance.getInitialNotification).toHaveBeenCalledTimes(1);
    expect(instance.onNotificationOpenedApp).toHaveBeenCalledTimes(1);
    // Registered at module scope from index.js instead, never from App.tsx.
    expect(instance.setBackgroundMessageHandler).not.toHaveBeenCalled();
  });

  it("registers the shared background handler body", () => {
    const instance = mockMessaging();
    mockMessaging.mockReturnValue(instance);

    notificationHandler.registerBackgroundMessageHandler();

    expect(instance.setBackgroundMessageHandler).toHaveBeenCalledWith(
      handleBackgroundMessage,
    );
  });

  it("handles a data-only background message without throwing", async () => {
    await expect(
      handleBackgroundMessage({
        messageId: "m-1",
        data: { kind: "sync" },
        fcmOptions: {},
      }),
    ).resolves.toBeUndefined();
    await expect(
      handleBackgroundMessage({ data: {}, fcmOptions: {} }),
    ).resolves.toBeUndefined();
  });

  it("requestUserPermission returns token when PROVISIONAL", async () => {
    const instance = mockMessaging();
    mockMessaging.mockReturnValue(instance);
    instance.requestPermission.mockResolvedValue(
      mockMessaging.AuthorizationStatus.PROVISIONAL,
    );
    instance.getToken.mockResolvedValue("provisional-token");

    const token = await notificationHandler.requestUserPermission();

    expect(token).toBe("provisional-token");
  });

  it("requestUserPermission returns undefined when not enabled", async () => {
    const instance = mockMessaging();
    mockMessaging.mockReturnValue(instance);
    instance.requestPermission.mockResolvedValue(0); // denied

    const token = await notificationHandler.requestUserPermission();

    expect(token).toBeUndefined();
  });

  it("getToken returns undefined on error", async () => {
    const instance = mockMessaging();
    mockMessaging.mockReturnValue(instance);
    instance.requestPermission.mockResolvedValue(
      mockMessaging.AuthorizationStatus.AUTHORIZED,
    );
    instance.getToken.mockRejectedValue(new Error("FCM unavailable"));

    const token = await notificationHandler.requestUserPermission();

    expect(token).toBeUndefined();
  });

  it("subscribeToTopic delegates to messaging", async () => {
    const instance = mockMessaging();
    mockMessaging.mockReturnValue(instance);
    instance.subscribeToTopic.mockResolvedValue(undefined);

    await notificationHandler.subscribeToTopic("competition-123");

    expect(instance.subscribeToTopic).toHaveBeenCalledWith("competition-123");
  });

  it("unsubscribeFromTopic delegates to messaging", async () => {
    const instance = mockMessaging();
    mockMessaging.mockReturnValue(instance);
    instance.unsubscribeFromTopic.mockResolvedValue(undefined);

    await notificationHandler.unsubscribeFromTopic("competition-123");

    expect(instance.unsubscribeFromTopic).toHaveBeenCalledWith(
      "competition-123",
    );
  });
});
