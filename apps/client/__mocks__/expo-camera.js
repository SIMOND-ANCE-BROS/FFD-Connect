const React = require("react");
const { View } = require("react-native");

module.exports = {
  CameraView: (props) => React.createElement(View, props),
  Camera: { requestCameraPermissionsAsync: jest.fn() },
  CameraType: { back: "back", front: "front" },
  FlashMode: { on: "on", off: "off" },
  PermissionStatus: {
    GRANTED: "granted",
    DENIED: "denied",
    UNDETERMINED: "undetermined",
  },
  useCameraPermissions: jest.fn(() => [
    { granted: true, canAskAgain: true, expires: "never", status: "granted" },
    jest.fn().mockResolvedValue({ granted: true, status: "granted" }),
  ]),
};
