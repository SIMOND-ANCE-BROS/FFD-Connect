/**
 * Biometrics Adapter
 * Provides a react-native-biometrics compatible API using expo-local-authentication.
 *
 * Note (2026-07): the long "iOS 26 Face ID crash" investigation turned out to be
 * a red herring — there was never a crash. On-device diagnostics showed
 * canEvaluatePolicy simply returning false because the app's per-app Face ID
 * permission (iOS Settings → app → Face ID) was OFF. Once enabled, Face ID works
 * on iOS 26 exactly like any other iOS. So there is no iOS-26-specific guard,
 * flag, or native patch here anymore.
 */

import * as LocalAuthentication from "expo-local-authentication";
import { Platform } from "react-native";

export enum BiometryType {
  TouchID = "TouchID",
  FaceID = "FaceID",
  Face = "Face",
  Fingerprint = "Fingerprint",
  Iris = "Iris",
  None = "None",
}

export interface BiometryAvailability {
  available: boolean;
  biometryType?: BiometryType;
  error?: string;
}

export interface SimplePromptResult {
  success: boolean;
  error?: string;
}

/**
 * Adapter class that mimics react-native-biometrics API
 */
class BiometricsAdapter {
  /**
   * Check if biometric sensor is available
   */
  async isSensorAvailable(): Promise<BiometryAvailability> {
    try {
      if (Platform.OS === "web") {
        // Web: Use WebAuthn if available
        if (
          (navigator as { credentials?: { create: unknown } }).credentials &&
          "create" in
            (navigator as { credentials?: { create: unknown } }).credentials!
        ) {
          return {
            available: true,
            biometryType: BiometryType.None, // WebAuthn doesn't expose biometry type
          };
        }
        return {
          available: false,
          biometryType: BiometryType.None,
          error: "WebAuthn not available",
        };
      }

      // Native: Use expo-local-authentication
      const hasHardware = await LocalAuthentication.hasHardwareAsync();
      if (!hasHardware) {
        return {
          available: false,
          biometryType: BiometryType.None,
          error: "No biometric hardware available",
        };
      }

      const isEnrolled = await LocalAuthentication.isEnrolledAsync();
      if (!isEnrolled) {
        return {
          available: false,
          biometryType: BiometryType.None,
          error: "No biometrics enrolled",
        };
      }

      const supportedTypes =
        await LocalAuthentication.supportedAuthenticationTypesAsync();

      // Map expo types to react-native-biometrics types
      let biometryType = BiometryType.None;
      if (
        supportedTypes.includes(
          LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION,
        )
      ) {
        biometryType =
          Platform.OS === "ios" ? BiometryType.FaceID : BiometryType.Face;
      } else if (
        supportedTypes.includes(
          LocalAuthentication.AuthenticationType.FINGERPRINT,
        )
      ) {
        biometryType =
          Platform.OS === "ios"
            ? BiometryType.TouchID
            : BiometryType.Fingerprint;
      } else if (
        supportedTypes.includes(LocalAuthentication.AuthenticationType.IRIS)
      ) {
        biometryType = BiometryType.Iris;
      }

      return {
        available: true,
        biometryType,
      };
    } catch (error) {
      return {
        available: false,
        biometryType: BiometryType.None,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Simple prompt for biometric authentication
   */
  async simplePrompt(options: {
    promptMessage: string;
  }): Promise<SimplePromptResult> {
    try {
      if (Platform.OS === "web") {
        // Web: Use WebAuthn
        // Note: This is a simplified implementation
        // Full WebAuthn integration would require more setup
        return {
          success: false,
          error: "WebAuthn not yet fully implemented",
        };
      }

      // Native: Use expo-local-authentication
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: options.promptMessage,
        cancelLabel: "Cancel",
        disableDeviceFallback: false,
      });

      return {
        success: result.success,
        error: result.success ? undefined : "Authentication failed",
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Create keys (for advanced usage - not fully implemented)
   */
  createKeys(): Promise<{ publicKey: string }> {
    throw new Error(
      "createKeys not implemented - use simplePrompt for basic authentication",
    );
  }

  /**
   * Create signature (for advanced usage - not fully implemented)
   */
  async createSignature(options: {
    promptMessage: string;
    payload: string;
  }): Promise<{ success: boolean; signature?: string }> {
    // Fallback to simple prompt
    const result = await this.simplePrompt({
      promptMessage: options.promptMessage,
    });
    return {
      success: result.success,
      signature: result.success ? "signature-placeholder" : undefined,
    };
  }
}

// Export singleton instance (matching react-native-biometrics API)
const biometricsAdapter = new BiometricsAdapter();
export default biometricsAdapter;

// Export BiometryType as BiometryTypes for compatibility
export const BiometryTypes = BiometryType;
