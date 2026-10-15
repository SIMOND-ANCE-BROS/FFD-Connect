/**
 * Affichage QR code en natif (react-native-qrcode-svg).
 * Utilisé uniquement sur iOS/Android.
 */

import React from "react";
import { View } from "react-native";
import QRCode from "react-native-qrcode-svg";

interface QRCodeViewProps {
  value: string;
  size?: number;
  /**
   * Spoken name of the code. Omit it when the QR sits inside a labelled
   * button (the button names it); pass it when the code stands alone.
   */
  spokenLabel?: string;
}

export function QRCodeView({
  value,
  size = 120,
  spokenLabel,
}: QRCodeViewProps) {
  if (!spokenLabel) return <QRCode value={value} size={size} />;
  // The SVG has no accessible name: wrap it in a named image (RGAA 1.1).
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={spokenLabel}
      accessibilityHint="À présenter au contrôle pour être scanné"
    >
      <QRCode value={value} size={size} />
    </View>
  );
}
