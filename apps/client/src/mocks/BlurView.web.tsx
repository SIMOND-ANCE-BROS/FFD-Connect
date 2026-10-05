import { StyleSheet, View, ViewProps } from "react-native";

export const BlurView = (
  props: ViewProps & { blurType?: string; blurAmount?: number },
) => {
  return <View {...props} style={[props.style, styles.blur]} />;
};

const styles = StyleSheet.create({
  blur: { backgroundColor: "rgba(255,255,255,0.8)" },
});

export default BlurView;
