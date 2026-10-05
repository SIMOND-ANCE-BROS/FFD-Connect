/**
 * Affichage QR code en natif (react-native-qrcode-svg).
 * Utilisé uniquement sur iOS/Android.
 */

import React from "react";
import QRCode from "react-native-qrcode-svg";

interface QRCodeViewProps {
  value: string;
  size?: number;
}

export function QRCodeView({ value, size = 120 }: QRCodeViewProps) {
  return <QRCode value={value} size={size} />;
}
