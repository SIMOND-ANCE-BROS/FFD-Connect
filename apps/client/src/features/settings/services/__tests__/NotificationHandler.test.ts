import { Alert } from "react-native";
import type { MockNotificationMessage } from "../../../../__tests__/mocks/types";
import {
  handleBackgroundMessage,
  notificationHandler,
} from "../NotificationHandler";

let onMessageHandler: ((message: MockNotificationMessage) => void) | null =
  null;

let mockMessaging: jest.Mock;

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
    onNotificationOpenedApp: jest.fn(),
    getInitialNotification: jest.fn().mockResolvedValue(null),
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
