import React from "react";
import {
  Alert,
  Modal,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { AppButton } from "../../../../components/AppButton";
import { AppText } from "../../../../components/AppText";

interface PartnerInputModalProps {
  visible: boolean;
  eventLabel: string;
  onConfirm: (partnerName: string) => void;
  onClose: () => void;
  theme: {
    surface: string;
    text: string;
    textSecondary: string;
    border: string;
    primary: string;
  };
}

/** Modal pour saisir le nom du partenaire avant inscription à une épreuve couple */
export function PartnerInputModal({
  visible,
  eventLabel,
  onConfirm,
  onClose,
  theme,
}: PartnerInputModalProps) {
  const [partnerName, setPartnerName] = React.useState("");
  const handleSubmit = () => {
    if (partnerName.trim()) {
      onConfirm(partnerName.trim());
      setPartnerName("");
    } else {
      Alert.alert("Erreur", "Indiquez le nom de votre partenaire.");
    }
  };
  const handleClose = () => {
    setPartnerName("");
    onClose();
  };
  return (
    <Modal visible={visible} transparent animationType="fade">
      <TouchableOpacity
        activeOpacity={1}
        style={partnerModalStyles.overlay}
        onPress={handleClose}
        accessibilityRole="button"
        accessibilityLabel="Fermer"
        accessibilityHint="Ferme la saisie du partenaire"
      >
        <TouchableOpacity
          activeOpacity={1}
          onPress={(e) => e.stopPropagation()}
          accessibilityRole="none"
        >
          <View
            style={[partnerModalStyles.box, { backgroundColor: theme.surface }]}
          >
            <AppText
              variant="h3"
              color={theme.text}
              style={partnerModalStyles.title}
            >
              Inscription en couple
            </AppText>
            <AppText
              variant="caption"
              color={theme.textSecondary}
              style={partnerModalStyles.subtitle}
            >
              {eventLabel}
            </AppText>
            <TextInput
              placeholder="Nom du partenaire"
              placeholderTextColor={theme.textSecondary}
              value={partnerName}
              onChangeText={setPartnerName}
              style={[
                partnerModalStyles.input,
                { color: theme.text, borderColor: theme.border },
              ]}
              accessibilityLabel="Nom du partenaire"
              accessibilityHint="Saisissez le nom de votre partenaire de danse"
            />
            <View style={partnerModalStyles.buttons}>
              <AppButton
                title="Annuler"
                variant="outline"
                onPress={handleClose}
                style={partnerModalStyles.btn}
              />
              <AppButton
                title="Valider"
                variant="primary"
                onPress={handleSubmit}
                style={partnerModalStyles.btn}
              />
            </View>
          </View>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

const partnerModalStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  box: {
    width: "100%",
    maxWidth: 340,
    borderRadius: 16,
    padding: 20,
  },
  title: { marginBottom: 4 },
  subtitle: { marginBottom: 16 },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    marginBottom: 16,
  },
  buttons: { flexDirection: "row", gap: 12, justifyContent: "flex-end" },
  btn: { flex: 1 },
});
