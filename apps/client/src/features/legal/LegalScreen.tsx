import { NativeStackScreenProps } from "@react-navigation/native-stack";
import React, { useState } from "react";
import { ScrollView, StatusBar, StyleSheet, View } from "react-native";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import { AppText } from "../../components/AppText";
import { BackButton } from "../../components/BackButton";
import { PinnedHeader } from "../../components/PinnedHeader";
import { useTheme } from "../../context/ThemeContext";
import { RootStackParamList } from "../../navigation/types";
import { LEGAL_DOCUMENTS } from "./legalContent";

type Props = NativeStackScreenProps<RootStackParamList, "Legal">;

/**
 * Écran générique des documents légaux (#424) : CGU, politique de
 * confidentialité, mentions légales — le document est choisi par route param.
 */
export const LegalScreen = ({ route, navigation }: Props) => {
  const { theme, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const [headerH, setHeaderH] = useState(insets.top + 56);
  // Défaut défensif : params absents (deep link nu, montage par le test du
  // navigateur) → CGU.
  const doc = LEGAL_DOCUMENTS[route.params?.doc ?? "cgu"];

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: theme.background }]}
      edges={["left", "right"]}
    >
      <StatusBar
        barStyle={theme.statusBarStyle}
        backgroundColor={theme.background}
      />

      <ScrollView
        contentContainerStyle={{
          ...styles.content,
          paddingTop: headerH + 8,
        }}
        testID="legal-scroll-view"
      >
        <AppText variant="caption" color={theme.textSecondary}>
          Dernière mise à jour : {doc.updatedAt}
        </AppText>

        {doc.sections.map((section, index) => (
          <View key={index} style={styles.section}>
            {section.heading ? (
              <AppText
                variant="h3"
                color={theme.text}
                style={styles.sectionHeading}
              >
                {section.heading}
              </AppText>
            ) : null}
            <AppText
              variant="body"
              color={theme.textSecondary}
              style={styles.sectionBody}
            >
              {section.body}
            </AppText>
          </View>
        ))}
      </ScrollView>

      <PinnedHeader
        theme={theme}
        isDark={isDark}
        title={doc.title}
        onHeightChange={setHeaderH}
        left={<BackButton onPress={() => navigation.goBack()} />}
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 12,
  },
  backButton: { padding: 4 },
  headerTitle: { flex: 1, marginLeft: 4 },
  content: { paddingHorizontal: 20, paddingBottom: 48 },
  section: { marginTop: 20 },
  sectionHeading: { marginBottom: 6 },
  sectionBody: { lineHeight: 21 },
});
