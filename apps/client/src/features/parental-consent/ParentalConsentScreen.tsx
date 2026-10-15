import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Mail, ShieldCheck } from "lucide-react-native";
import React, { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StatusBar,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import { AppButton } from "../../components/AppButton";
import { AppText } from "../../components/AppText";
import { BackButton } from "../../components/BackButton";
import { PinnedHeader } from "../../components/PinnedHeader";
import { useTheme } from "../../context/ThemeContext";
import { RootStackParamList } from "../../navigation/types";
import {
  consentCopy,
  looksLikeEmail,
  needsParentalAction,
} from "./parentalConsent";
import { useParentalConsent } from "./useParentalConsent";

type ParentalConsentScreenProps = NativeStackScreenProps<
  RootStackParamList,
  "ParentalConsent"
>;

/**
 * Parental consent of a minor's account (#61): where it stands, and the
 * parent's address to send (or re-send) the link to. The parent answers on
 * the web page of the link, never in the app.
 */
export const ParentalConsentScreen = ({
  navigation,
}: ParentalConsentScreenProps) => {
  const { theme, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const [headerH, setHeaderH] = useState(insets.top + 56);
  const [parentEmail, setParentEmail] = useState("");
  const [feedback, setFeedback] = useState<{
    kind: "error" | "success";
    text: string;
  } | null>(null);
  const { consent, isLoading, error, refetch, request } = useParentalConsent();

  const submit = () => {
    const email = parentEmail.trim();
    if (!looksLikeEmail(email)) {
      setFeedback({
        kind: "error",
        text: "Saisissez une adresse e-mail valide.",
      });
      return;
    }
    setFeedback(null);
    request.mutate(email, {
      onSuccess: () => {
        setParentEmail("");
        setFeedback({
          kind: "success",
          text: "Demande envoyée. Votre représentant légal doit ouvrir le lien reçu par e-mail.",
        });
      },
      onError: (err) => {
        setFeedback({ kind: "error", text: err.message });
      },
    });
  };

  const inputBg = isDark ? "rgba(255, 255, 255, 0.05)" : "rgba(0, 0, 0, 0.05)";
  const canRequest = needsParentalAction(consent);

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: theme.background }]}
      edges={["left", "right"]}
    >
      <StatusBar barStyle={theme.statusBarStyle} />
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.flex}
      >
        <ScrollView
          contentContainerStyle={[styles.content, { paddingTop: headerH }]}
          keyboardShouldPersistTaps="handled"
        >
          {isLoading ? (
            <ActivityIndicator
              testID="parental-consent-loading"
              color={theme.primary}
              style={styles.loader}
            />
          ) : error || !consent ? (
            <View style={styles.block}>
              <AppText variant="body" color={theme.textSecondary}>
                Impossible de charger l'état de l'accord parental.
              </AppText>
              <AppButton
                testID="parental-consent-retry"
                title="Réessayer"
                onPress={() => {
                  void refetch();
                }}
                style={styles.button}
              />
            </View>
          ) : (
            <View style={styles.block}>
              <View style={styles.titleRow}>
                <ShieldCheck size={24} color={theme.primary} />
                <AppText
                  variant="h2"
                  color={theme.text}
                  style={styles.flex}
                  testID="parental-consent-title"
                >
                  {consentCopy(consent).title}
                </AppText>
              </View>
              <AppText
                variant="body"
                color={theme.textSecondary}
                testID="parental-consent-message"
              >
                {consentCopy(consent).message}
              </AppText>

              {canRequest ? (
                <>
                  <AppText
                    variant="caption"
                    color={theme.textSecondary}
                    style={styles.label}
                  >
                    {consent.state === "PENDING"
                      ? "RENVOYER LA DEMANDE (LE LIEN PRÉCÉDENT NE FONCTIONNERA PLUS)"
                      : "E-MAIL D'UN PARENT OU REPRÉSENTANT LÉGAL"}
                  </AppText>
                  <View
                    style={[
                      styles.inputWrapper,
                      { backgroundColor: inputBg, borderColor: theme.border },
                    ]}
                  >
                    <Mail size={20} color={theme.textSecondary} />
                    <TextInput
                      testID="parental-consent-email-input"
                      accessibilityLabel="E-mail du représentant légal"
                      accessibilityHint="Saisissez l'adresse e-mail d'un parent ou représentant légal"
                      style={[styles.input, { color: theme.text }]}
                      placeholder="parent@exemple.fr"
                      placeholderTextColor={theme.textSecondary}
                      value={parentEmail}
                      onChangeText={setParentEmail}
                      onSubmitEditing={submit}
                      returnKeyType="send"
                      keyboardType="email-address"
                      autoCapitalize="none"
                      autoCorrect={false}
                      autoComplete="off"
                    />
                  </View>
                  <AppButton
                    testID="parental-consent-submit"
                    title={
                      consent.state === "PENDING"
                        ? "Renvoyer la demande"
                        : "Envoyer la demande"
                    }
                    onPress={submit}
                    loading={request.isPending}
                    style={styles.button}
                  />
                </>
              ) : null}

              {feedback ? (
                <AppText
                  variant="body"
                  testID="parental-consent-feedback"
                  color={
                    feedback.kind === "error" ? theme.danger : theme.success
                  }
                  accessibilityLiveRegion="polite"
                >
                  {feedback.text}
                </AppText>
              ) : null}

              <AppText
                variant="caption"
                color={theme.textSecondary}
                style={styles.note}
              >
                Votre représentant légal reçoit un lien valable 7 jours. Il
                l'ouvre dans son navigateur pour donner son accord, et pourra le
                retirer à tout moment avec ce même lien. Son adresse n'est pas
                conservée en clair.
              </AppText>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>

      <PinnedHeader
        theme={theme}
        isDark={isDark}
        title="Accord parental"
        onHeightChange={setHeaderH}
        left={<BackButton onPress={() => navigation.goBack()} />}
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  flex: { flex: 1 },
  content: { flexGrow: 1, padding: 20, paddingBottom: 40 },
  loader: { marginTop: 40 },
  block: { gap: 12 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  label: { marginTop: 12, letterSpacing: 0.5 },
  inputWrapper: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderWidth: 1,
    gap: 12,
  },
  input: { flex: 1, fontSize: 16 },
  button: { marginTop: 4 },
  note: { marginTop: 16, lineHeight: 18 },
});
