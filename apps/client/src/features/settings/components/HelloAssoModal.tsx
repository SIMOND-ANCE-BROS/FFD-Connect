/* eslint-disable react-native-a11y/has-accessibility-hint */
import { useState } from "react";
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { AppButton } from "../../../components/AppButton";
import { AppText } from "../../../components/AppText";
import { useTheme } from "../../../context/ThemeContext";
import {
  ClubService,
  ConnectHelloAssoParams,
} from "../../club/services/ClubService";

interface HelloAssoModalProps {
  visible: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export const HelloAssoModal = ({
  visible,
  onClose,
  onSuccess,
}: HelloAssoModalProps) => {
  const { theme: currentTheme } = useTheme();
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [organizationSlug, setOrganizationSlug] = useState("");
  const [loading, setLoading] = useState(false);

  const resetForm = () => {
    setClientId("");
    setClientSecret("");
    setOrganizationSlug("");
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  const handleSubmit = async () => {
    const params: ConnectHelloAssoParams = {
      clientId: clientId.trim(),
      clientSecret: clientSecret.trim(),
      organizationSlug: organizationSlug.trim(),
    };
    if (!params.clientId || !params.clientSecret || !params.organizationSlug) {
      Alert.alert("Erreur", "Veuillez remplir tous les champs.");
      return;
    }

    setLoading(true);
    try {
      await ClubService.connectHelloAsso(params);
      Alert.alert(
        "Compte connecté",
        "Votre compte HelloAsso est maintenant lié au club. Les paiements des places utiliseront ce compte.",
        [
          {
            text: "OK",
            onPress: () => {
              resetForm();
              onSuccess();
              onClose();
            },
          },
        ],
      );
    } catch (error: unknown) {
      const message =
        error && typeof error === "object" && "response" in error
          ? (error as { response?: { data?: { message?: string | string[] } } })
              .response?.data?.message
          : null;
      const msg = Array.isArray(message)
        ? message.join("\n")
        : typeof message === "string"
          ? message
          : "Impossible de connecter le compte. Vérifiez vos identifiants HelloAsso.";
      Alert.alert("Erreur", msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={handleClose}
    >
      <Pressable
        accessibilityRole="button"
        style={styles.overlay}
        onPress={handleClose}
      >
        <Pressable
          accessibilityRole="button"
          style={[styles.modal, { backgroundColor: currentTheme.surface }]}
          onPress={(e) => e.stopPropagation()}
        >
          <View style={styles.header}>
            <AppText variant="h2" color={currentTheme.text}>
              Connecter HelloAsso
            </AppText>
            <TouchableOpacity
              accessibilityRole="button"
              onPress={handleClose}
              style={styles.closeButton}
            >
              <Text
                style={[
                  styles.closeButtonText,
                  { color: currentTheme.textSecondary },
                ]}
              >
                ✕
              </Text>
            </TouchableOpacity>
          </View>

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
          >
            <Text style={[styles.hint, { color: currentTheme.textSecondary }]}>
              Saisissez les identifiants de l’application HelloAsso de votre
              club (créée sur helloasso.com). Les paiements des places pour vos
              compétitions utiliseront ce compte.
            </Text>

            <View style={styles.inputContainer}>
              <Text style={[styles.label, { color: currentTheme.text }]}>
                Client ID
              </Text>
              <TextInput
                accessibilityLabel="Client ID HelloAsso"
                style={[
                  styles.input,
                  {
                    color: currentTheme.text,
                    borderColor: currentTheme.border,
                  },
                ]}
                placeholder="Client ID"
                placeholderTextColor={currentTheme.textSecondary}
                value={clientId}
                onChangeText={setClientId}
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>

            <View style={styles.inputContainer}>
              <Text style={[styles.label, { color: currentTheme.text }]}>
                Client Secret
              </Text>
              <TextInput
                accessibilityLabel="Client Secret HelloAsso"
                style={[
                  styles.input,
                  {
                    color: currentTheme.text,
                    borderColor: currentTheme.border,
                  },
                ]}
                placeholder="Client Secret"
                placeholderTextColor={currentTheme.textSecondary}
                value={clientSecret}
                onChangeText={setClientSecret}
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>

            <View style={styles.inputContainer}>
              <Text style={[styles.label, { color: currentTheme.text }]}>
                Slug de l’organisation
              </Text>
              <TextInput
                accessibilityLabel="Slug organisation HelloAsso"
                style={[
                  styles.input,
                  {
                    color: currentTheme.text,
                    borderColor: currentTheme.border,
                  },
                ]}
                placeholder="ex: mon-club-danse"
                placeholderTextColor={currentTheme.textSecondary}
                value={organizationSlug}
                onChangeText={setOrganizationSlug}
                autoCapitalize="none"
                autoCorrect={false}
              />
              <Text
                style={[styles.slugHint, { color: currentTheme.textSecondary }]}
              >
                Visible dans l’URL de votre compte HelloAsso
              </Text>
            </View>

            <View style={styles.actions}>
              <AppButton
                title="Annuler"
                onPress={handleClose}
                variant="secondary"
                style={styles.button}
              />
              <AppButton
                title={loading ? "Connexion…" : "Connecter"}
                onPress={() => {
                  handleSubmit().catch(() => {});
                }}
                disabled={loading}
                style={styles.button}
              />
            </View>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  modal: {
    width: "100%",
    maxWidth: 400,
    maxHeight: "85%",
    borderRadius: 16,
    overflow: "hidden",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(128,128,128,0.2)",
  },
  closeButton: {
    padding: 4,
  },
  closeButtonText: {
    fontSize: 20,
  },
  scroll: {
    maxHeight: 400,
  },
  content: {
    padding: 16,
  },
  hint: {
    fontSize: 14,
    marginBottom: 16,
    lineHeight: 20,
  },
  label: {
    fontSize: 14,
    fontWeight: "600",
    marginBottom: 6,
  },
  inputContainer: {
    marginBottom: 16,
  },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
  },
  slugHint: {
    fontSize: 12,
    marginTop: 4,
  },
  actions: {
    flexDirection: "row",
    gap: 12,
    marginTop: 8,
    marginBottom: 16,
  },
  button: {
    flex: 1,
  },
});
