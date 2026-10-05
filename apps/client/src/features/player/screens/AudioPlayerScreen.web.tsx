/**
 * AudioPlayerScreen pour le web : le lecteur audio est réservé au mobile
 */
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Music } from "lucide-react-native";
import React from "react";
import { StyleSheet, View } from "react-native";
import { AppText } from "../../../components/AppText";
import { useTheme } from "../../../context/ThemeContext";
import { RootStackParamList } from "../../../navigation/types";

type AudioPlayerScreenProps = NativeStackScreenProps<
  RootStackParamList,
  "AudioPlayer"
>;

export const AudioPlayerScreen = (_props: AudioPlayerScreenProps) => {
  const { theme: currentTheme } = useTheme();

  return (
    <View
      style={[styles.container, { backgroundColor: currentTheme.background }]}
    >
      <Music size={48} color={currentTheme.primary} />
      <AppText style={[styles.message, { color: currentTheme.text }]}>
        Le lecteur audio est disponible dans l'application mobile.
      </AppText>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  message: {
    marginTop: 16,
    fontSize: 16,
    textAlign: "center",
  },
});
