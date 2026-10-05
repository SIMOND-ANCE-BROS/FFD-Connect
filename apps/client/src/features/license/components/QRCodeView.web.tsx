/**
 * Affichage QR code sur le web (librairie qrcode + Image).
 * Évite d’importer react-native-qrcode-svg sur le web.
 */

import React, { useEffect, useState } from "react";
import { Image, StyleSheet, View } from "react-native";
import QRCode from "qrcode";

interface QRCodeViewProps {
  value: string;
  size?: number;
}

export function QRCodeView({ value, size = 120 }: QRCodeViewProps) {
  const [uri, setUri] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(value, { width: size, margin: 1 })
      .then((dataUrl) => {
        if (!cancelled) setUri(dataUrl);
      })
      .catch(() => {
        if (!cancelled) setUri(null);
      });
    return () => {
      cancelled = true;
    };
  }, [value, size]);

  if (!uri)
    return <View style={[styles.placeholder, { width: size, height: size }]} />;

  return (
    <Image
      source={{ uri }}
      style={{ width: size, height: size }}
      resizeMode="contain"
    />
  );
}

const styles = StyleSheet.create({
  placeholder: {
    backgroundColor: "rgba(0,0,0,0.06)",
  },
});
