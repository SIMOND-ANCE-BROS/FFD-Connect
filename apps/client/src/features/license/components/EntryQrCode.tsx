import React, { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { AppText } from "../../../components/AppText";
import { currentEntryQr, type EntryQrBatch } from "../utils/entryQr";
import { QRCodeView } from "./QRCodeView.native";

interface EntryQrCodeProps {
  /** Batch of the licensee (#24); null ⇒ static QR. */
  batch: EntryQrBatch | null;
  /** Static content (signed v2 QR, Wallet-compatible) shown without batch. */
  fallbackValue: string;
  size: number;
}

/**
 * Entry QR of the E-Licence (#24, ADR-0023): the rotating QR of the current
 * 30-second step when a batch covers now — useless as a screenshot,
 * verifiable offline — else the static QR, as before.
 */
export function EntryQrCode({ batch, fallbackValue, size }: EntryQrCodeProps) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    if (!batch) return undefined;
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, [batch]);

  const current = batch ? currentEntryQr(batch, now) : null;

  return (
    <View style={styles.container} testID="entry-qr-code">
      <QRCodeView value={current?.qrData ?? fallbackValue} size={size} />
      {current ? (
        <AppText
          variant="caption"
          align="center"
          style={styles.caption}
          testID="entry-qr-countdown"
        >
          {`QR d'entrée sécurisé · se renouvelle dans ${current.secondsLeft} s`}
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
  },
  caption: {
    marginTop: 12,
  },
});
