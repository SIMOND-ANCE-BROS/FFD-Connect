import React from "react";
import { StyleSheet, View } from "react-native";
import { AppText } from "../../../components/AppText";

interface BigBarcodeProps {
  value: string;
}

export const BigBarcode: React.FC<BigBarcodeProps> = ({ value }) => {
  const bars = [];
  for (let i = 0; i < 40; i++) {
    const width = i % 3 === 0 ? 8 : 4;
    const margin = i % 2 === 0 ? 2 : 4;
    bars.push(
      <View
        key={i}
        style={[
          styles.barcodeBar,
          {
            width: width,
            marginRight: margin,
          },
        ]}
      />,
    );
  }
  return (
    <View style={styles.barcodeContainer}>
      <View style={styles.barcodeBars}>{bars}</View>
      <AppText variant="h2" style={styles.barcodeText}>
        {value}
      </AppText>
    </View>
  );
};

const styles = StyleSheet.create({
  barcodeContainer: {
    alignItems: "center",
    backgroundColor: "white",
    padding: 20,
    borderRadius: 10,
  },
  barcodeBars: {
    flexDirection: "row",
    justifyContent: "center",
    overflow: "hidden",
  },
  barcodeText: {
    marginTop: 15,
    color: "black",
    letterSpacing: 2,
  },
  barcodeBar: {
    height: 60,
    backgroundColor: "black",
  },
});
