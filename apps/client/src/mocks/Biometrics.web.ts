export const BiometryTypes = {
  TouchID: "TouchID",
  FaceID: "FaceID",
  Biometrics: "Biometrics",
};
export default class ReactNativeBiometrics {
  simplePrompt() {
    return { success: false };
  }
  isSensorAvailable() {
    return { available: false, biometryType: undefined };
  }
  createKeys() {
    return { publicKey: "" };
  }
  deleteKeys() {
    return { success: true };
  }
  createSignature() {
    return { success: false, signature: undefined };
  }
}
