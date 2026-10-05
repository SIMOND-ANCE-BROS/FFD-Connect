import { View } from "react-native";
import { AppText } from "../../../../components/AppText";
import { styles } from "./license-card.styles";

interface BarcodeProps {
  value: string;
  width?: number;
}

// Simple Barcode Simulation Component using Views for maximum compatibility
export const Barcode: React.FC<BarcodeProps> = ({ value, width = 100 }) => {
  const bars = [];
  const numBars = 35;

  for (let i = 0; i < numBars; i++) {
    const barWidth = i % 3 === 0 ? 3 : 1;
    const margin = i % 2 === 0 ? 1 : 2;
    bars.push(
      <View
        key={i}
        style={[
          styles.barcodeLine,
          {
            width: barWidth,
            marginRight: margin,
          },
        ]}
      />,
    );
  }

  return (
    <View style={[styles.barcodeContainer, { width: width }]}>
      <View style={styles.barcodeInner}>{bars}</View>
      <View style={styles.barcodeTextWrapper}>
        <AppText variant="caption" style={styles.barcodeText}>
          {value}
        </AppText>
      </View>
    </View>
  );
};
