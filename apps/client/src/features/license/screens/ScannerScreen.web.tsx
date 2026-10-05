/**
 * Version web du Scanner : pas d’accès caméra.
 * Le scan QR est réservé à l’app mobile.
 */

import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Scan, X } from "lucide-react-native";
import React from "react";
import { StyleSheet, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppText } from "../../../components/AppText";
import { useTheme } from "../../../context/ThemeContext";
import { RootStackParamList } from "../../../navigation/types";

type Props = NativeStackScreenProps<RootStackParamList, "Scanner">;

export const ScannerScreen = ({ navigation }: Props) => {
  const insets = useSafeAreaInsets();
  const { theme: currentTheme } = useTheme();

  return (
    <View
      style={[styles.container, { backgroundColor: currentTheme.background }]}
    >
      <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
        <TouchableOpacity
          accessibilityRole="button"
          testID="scanner-back-button"
          style={styles.circleButton}
          onPress={() => navigation.goBack()}
        >
          <X size={24} color={currentTheme.text} />
        </TouchableOpacity>
      </View>

      <View style={styles.content}>
        <View
          style={[styles.iconWrap, { backgroundColor: currentTheme.surface }]}
        >
          <Scan size={64} color={currentTheme.primary} />
        </View>
        <AppText
          variant="h2"
          style={[styles.title, { color: currentTheme.text }]}
        >
          Scan QR code
        </AppText>
        <AppText
          variant="body"
          style={[styles.message, { color: currentTheme.textSecondary }]}
        >
          Le scan de QR code est disponible uniquement sur l’application mobile
          (iOS ou Android). Ouvrez FFD Connect sur votre téléphone pour scanner.
        </AppText>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    paddingHorizontal: 20,
    paddingBottom: 10,
  },
  circleButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(0,0,0,0.06)",
    justifyContent: "center",
    alignItems: "center",
  },
  content: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 32,
  },
  iconWrap: {
    width: 120,
    height: 120,
    borderRadius: 60,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 24,
  },
  title: {
    textAlign: "center",
    marginBottom: 12,
  },
  message: {
    textAlign: "center",
    lineHeight: 22,
  },
});
