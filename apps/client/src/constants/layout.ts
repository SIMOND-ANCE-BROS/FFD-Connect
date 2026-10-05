import { Dimensions } from "react-native";

const { width, height } = Dimensions.get("window");

export const LAYOUT = {
  window: {
    width,
    height,
  },
  tabBar: {
    height: 70,
    width: width * 0.9,
    padding: 15,
    safePadding: 20, // Extra padding to clear the floating bar comfortably
  },
};
