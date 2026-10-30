import React from "react";
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { AppButton } from "../../../../components/AppButton";
import { AppText } from "../../../../components/AppText";
import type { CurrentPartner } from "../../../career/hooks/useCurrentPartner";

/** From this text size on, the buttons stack instead of sharing a row. */
const STACKED_BUTTONS_FONT_SCALE = 1.3;

/**
 * A licensee cannot declare a partnership: their club does (a self-service
 * request is #875). The action therefore only shows the partnerships.
 * ` `: no-break space before « ; », never alone at a line start.
 */
export const NO_PARTNER_COPY = {
  TITLE: "Aucun partenaire enregistré",
  MESSAGE:
    "Une épreuve en couple se danse à deux. C'est votre club qui déclare votre couple ; en attendant, vous pouvez saisir le nom de votre partenaire ci-dessous.",
  ACTION: "Voir mes partenariats",
  ACTION_HINT: "Ouvre vos partenariats dans l'onglet Carrière",
} as const;

interface PartnerInputModalProps {
  visible: boolean;
  eventLabel: string;
  onConfirm: (partnerName: string) => void;
  onClose: () => void;
  /**
   * The dancer's registered partner (#858). `none` explains why a couple
   * event needs one and offers `onManagePartner`; `registered` pre-fills
   * the name. Omitted or `unknown`: plain name entry, as before.
   */
  partner?: CurrentPartner;
  /** Opens the partner management screen (Career tab, « Partenariats »). */
  onManagePartner?: () => void;
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
  partner,
  onManagePartner,
  theme,
}: PartnerInputModalProps) {
  const registeredName = partner?.status === "registered" ? partner.name : "";
  const [partnerName, setPartnerName] = React.useState(registeredName);
  // The career may load (or be refreshed, replacing a stale cached partner)
  // after the modal opened. The field follows the registered partner as
  // long as it still shows the last pre-filled value (or is empty); once the
  // dancer typed something else, it is theirs and is never overwritten.
  const lastPrefill = React.useRef(registeredName);
  React.useEffect(() => {
    if (!registeredName || registeredName === lastPrefill.current) return;
    const previous = lastPrefill.current;
    lastPrefill.current = registeredName;
    setPartnerName((current) =>
      current === "" || current === previous ? registeredName : current,
    );
  }, [registeredName]);
  const { fontScale } = useWindowDimensions();
  const stackButtons = fontScale >= STACKED_BUTTONS_FONT_SCALE;
  const showNoPartner = partner?.status === "none";
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
  const buttonStyle = stackButtons ? undefined : partnerModalStyles.btn;
  const cancelButton = (
    <AppButton
      title="Annuler"
      variant="outline"
      onPress={handleClose}
      style={buttonStyle}
    />
  );
  const confirmButton = (
    <AppButton
      title="Valider"
      variant="primary"
      onPress={handleSubmit}
      style={buttonStyle}
    />
  );
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={handleClose}
    >
      {/* Fond et carte sont frères (cf. SpaceSheet) : un bouton englobant la
          carte serait lu par VoiceOver comme un seul élément. */}
      <View style={partnerModalStyles.overlay}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={handleClose}
          testID="partner-input-backdrop"
          accessibilityRole="button"
          accessibilityLabel="Fermer"
          accessibilityHint="Ferme la saisie du partenaire"
        />
        <View
          testID="partner-input-card"
          style={[partnerModalStyles.box, { backgroundColor: theme.surface }]}
        >
          <ScrollView
            style={partnerModalStyles.scroll}
            keyboardShouldPersistTaps="handled"
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
            {showNoPartner && (
              <View
                testID="partner-input-no-partner"
                style={[
                  partnerModalStyles.notice,
                  {
                    // ~8% tint of the primary colour, like BetaNotice.
                    backgroundColor: `${theme.primary}14`,
                    borderColor: `${theme.primary}40`,
                  },
                ]}
              >
                {/* Title + message = one screen-reader stop; the button
                  stays a separate, focusable control. */}
                <View accessible accessibilityRole="text">
                  <AppText variant="body" weight="600" color={theme.text}>
                    {NO_PARTNER_COPY.TITLE}
                  </AppText>
                  <AppText variant="caption" color={theme.textSecondary}>
                    {NO_PARTNER_COPY.MESSAGE}
                  </AppText>
                </View>
                {onManagePartner && (
                  <AppButton
                    testID="partner-input-manage"
                    title={NO_PARTNER_COPY.ACTION}
                    variant="outline"
                    size="compact"
                    onPress={onManagePartner}
                    accessibilityHint={NO_PARTNER_COPY.ACTION_HINT}
                    style={partnerModalStyles.noticeAction}
                  />
                )}
              </View>
            )}
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
            <View
              testID="partner-input-buttons"
              style={[
                partnerModalStyles.buttons,
                stackButtons && partnerModalStyles.buttonsStacked,
              ]}
            >
              {/* Stacked, the main action comes first, in reading order:
                  screen readers follow the tree, not a reversed layout. */}
              {stackButtons ? (
                <>
                  {confirmButton}
                  {cancelButton}
                </>
              ) : (
                <>
                  {cancelButton}
                  {confirmButton}
                </>
              )}
            </View>
          </ScrollView>
        </View>
      </View>
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
    // Large text: the card scrolls instead of overflowing the screen.
    maxHeight: "90%",
    borderRadius: 16,
    padding: 20,
  },
  scroll: { flexGrow: 0 },
  notice: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
    gap: 4,
  },
  noticeAction: { marginTop: 8, alignSelf: "stretch" },
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
  buttonsStacked: { flexDirection: "column" },
  btn: { flex: 1 },
});
