/* eslint-disable react-native-a11y/has-accessibility-hint -- TODO: add a11y hints to org settings */
import * as Clipboard from "expo-clipboard";
import { Copy, Users, X } from "lucide-react-native";
import React from "react";
import {
  Alert,
  Modal,
  ScrollView,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import QRCode from "react-native-qrcode-svg";
import { AppButton } from "../../../../components/AppButton";
import { AppText } from "../../../../components/AppText";
import { AppTheme } from "../../../../context/ThemeContext";
import { VolunteerTokenResponse } from "../../../license/services/CheckinService";
import { LayoutItem } from "../../hooks/useClubCompetitionEditorLogic";
import { LayoutCanvas } from "../LayoutCanvas";
import { styles } from "./competition-editor.styles";

interface Props {
  theme: AppTheme;
  volunteerToken: VolunteerTokenResponse | null;
  setVolunteerToken: (t: VolunteerTokenResponse | null) => void;
  isGeneratingToken: boolean;
  handleGenerateVolunteerToken: () => Promise<void>;
  ticketingUrl: string;
  setTicketingUrl: (u: string) => void;
  layoutItems: LayoutItem[];
  showLayoutModal: boolean;
  setShowLayoutModal: (v: boolean) => void;
  newLayoutType: "TABLE" | "GRADIN" | "OTHER";
  setNewLayoutType: (t: "TABLE" | "GRADIN" | "OTHER") => void;
  newLayoutLabel: string;
  setNewLayoutLabel: (l: string) => void;
  newLayoutCapacity: string;
  setNewLayoutCapacity: (c: string) => void;
  newLayoutRows: string;
  setNewLayoutRows: (r: string) => void;
  newLayoutCols: string;
  setNewLayoutCols: (c: string) => void;
  newLayoutX: number;
  setNewLayoutX: (x: number) => void;
  newLayoutY: number;
  setNewLayoutY: (y: number) => void;
  newLayoutWidth: number;
  setNewLayoutWidth: (w: number) => void;
  newLayoutHeight: number;
  setNewLayoutHeight: (h: number) => void;
  newLayoutRotation: string;
  setNewLayoutRotation: (r: string) => void;
  openLayoutModal: (
    item?: LayoutItem,
    type?: "TABLE" | "GRADIN" | "OTHER",
  ) => void;
  updateLayoutItemPosition: (id: string, x: number, y: number) => void;
  toggleLayoutItemSeatLock: (id: string, seatIndex: number) => void;
  cycleLayoutItemOrientation: (id: string) => void;
  editingLayoutItem: LayoutItem | null;
  addLayoutItem: () => void;
  removeLayoutItem: (id: string) => void;
  duplicateLayoutItem: (id: string) => void;
}

export const CompetitionOrganisationTab: React.FC<Props> = ({
  theme,
  volunteerToken,
  setVolunteerToken,
  isGeneratingToken,
  handleGenerateVolunteerToken,
  ticketingUrl,
  setTicketingUrl,
  layoutItems,
  showLayoutModal,
  setShowLayoutModal,
  newLayoutType,
  setNewLayoutType,
  newLayoutLabel,
  setNewLayoutLabel,
  newLayoutCapacity,
  setNewLayoutCapacity,
  newLayoutRows,
  setNewLayoutRows,
  newLayoutCols,
  setNewLayoutCols,
  newLayoutX,
  setNewLayoutX,
  newLayoutY,
  setNewLayoutY,
  newLayoutWidth,
  setNewLayoutWidth,
  newLayoutHeight,
  setNewLayoutHeight,
  newLayoutRotation,
  setNewLayoutRotation,
  openLayoutModal,
  updateLayoutItemPosition,
  toggleLayoutItemSeatLock,
  cycleLayoutItemOrientation,
  editingLayoutItem,
  addLayoutItem,
  removeLayoutItem,
  duplicateLayoutItem,
}) => (
  <>
    <ScrollView style={[styles.scrollContent, styles.organisationContainer]}>
      <View style={styles.organisationDesc}>
        <AppText variant="body" style={{ color: theme.textSecondary }}>
          Gérez les accès pour vos collaborateurs et bénévoles.
        </AppText>
      </View>

      <View style={[styles.section, { backgroundColor: theme.surface }]}>
        <View style={styles.infoRow}>
          <View
            style={[
              styles.iconContainer,
              { backgroundColor: `${theme.primary}20` },
            ]}
          >
            <Users size={20} color={theme.primary} />
          </View>
          <View style={styles.flex1ML12}>
            <AppText variant="body" weight="600" style={{ color: theme.text }}>
              Accès Bénévoles
            </AppText>
            <AppText variant="caption" style={{ color: theme.textSecondary }}>
              Permet de scanner sans compte FFD
            </AppText>
          </View>
        </View>

        <View style={styles.mt16}>
          <AppButton
            title="Générer un QR d'accès"
            onPress={() => {
              handleGenerateVolunteerToken().catch(() => {});
            }}
            loading={isGeneratingToken}
            variant="outline"
          />
        </View>
      </View>

      <View
        style={[
          styles.section,
          { backgroundColor: theme.surface },
          styles.mt16,
        ]}
      >
        <AppText variant="h3" style={[styles.mb12, { color: theme.text }]}>
          Billetterie HelloAsso
        </AppText>
        <AppText
          variant="body"
          style={[styles.mb16, { color: theme.textSecondary }]}
        >
          Lien vers votre billetterie HelloAsso pour l'achat de places.
        </AppText>
        <TextInput
          accessibilityLabel="Lien HelloAsso"
          accessibilityHint="Lien vers la billetterie HelloAsso de la compétition"
          style={styles.ticketingInput}
          placeholder="https://www.helloasso.com/associations/..."
          placeholderTextColor={theme.textSecondary}
          value={ticketingUrl}
          onChangeText={setTicketingUrl}
        />
      </View>

      <View style={[styles.section, styles.layoutSection]}>
        <View style={styles.layoutHeader}>
          <AppText variant="h3" style={{ color: theme.text }}>
            Plan de salle
          </AppText>
        </View>
        <AppText
          variant="body"
          style={[
            styles.organisationDescription,
            { color: theme.textSecondary },
          ]}
        >
          Piste au centre. Pincez pour zoomer et faites glisser la vue si
          besoin. Appuyez sur un élément pour ouvrir le détail, et
          double‑touchez pour dupliquer rapidement. Vous pouvez verrouiller des
          places pour les rendre non réservable avant d'ouvrir la billetterie.
        </AppText>

        <LayoutCanvas
          layoutItems={layoutItems}
          theme={theme}
          onAddElement={(type) => openLayoutModal(undefined, type)}
          onEditElement={(item) => openLayoutModal(item)}
          onQuickEditElement={(item) => duplicateLayoutItem(item.id)}
          onPositionChange={updateLayoutItemPosition}
          onToggleSeatLock={toggleLayoutItemSeatLock}
          onCycleOrientation={cycleLayoutItemOrientation}
        />
      </View>
    </ScrollView>

    {/* Layout Item Modal */}
    <Modal
      visible={showLayoutModal}
      transparent
      animationType="slide"
      onRequestClose={() => setShowLayoutModal(false)}
    >
      <View style={styles.modalOverlay}>
        <View
          style={[
            styles.modalContent,
            { backgroundColor: theme.surface },
            styles.maxH80pct,
          ]}
        >
          <AppText
            variant="h3"
            style={[styles.modalTitle, { color: theme.text }]}
          >
            {editingLayoutItem ? "Modifier l'élément" : "Ajouter un élément"}
          </AppText>

          <View style={styles.inputGroup}>
            <AppText variant="caption" color={theme.textSecondary}>
              Type d'élément
            </AppText>
            <View style={styles.tagRowMT8}>
              {["TABLE", "GRADIN", "OTHER"].map((type) => {
                const isSelected = newLayoutType === type;
                const layoutTypeTextColor = {
                  color: isSelected ? "#FFF" : theme.primary,
                };
                return (
                  <TouchableOpacity
                    accessibilityRole="button"
                    accessibilityLabel={
                      type === "TABLE"
                        ? "Table"
                        : type === "GRADIN"
                          ? "Gradin"
                          : "Autre"
                    }
                    accessibilityHint={`Sélectionner le type ${type}`}
                    key={type}
                    onPress={() =>
                      setNewLayoutType(type as "TABLE" | "GRADIN" | "OTHER")
                    }
                    style={[
                      styles.layoutTypeChip,
                      {
                        backgroundColor: isSelected
                          ? theme.primary
                          : `${theme.primary}10`,
                        borderColor: theme.primary,
                      },
                    ]}
                  >
                    <AppText variant="caption" style={layoutTypeTextColor}>
                      {type === "TABLE"
                        ? "Table"
                        : type === "GRADIN"
                          ? "Gradin"
                          : "Autre"}
                    </AppText>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          <View style={[styles.inputGroup, styles.mt16]}>
            <AppText variant="caption" color={theme.textSecondary}>
              Nom / Numéro
            </AppText>
            <TextInput
              accessibilityLabel="Nom de l'élément"
              accessibilityHint="Saisissez le nom ou le numéro de la table ou du gradin"
              style={[
                styles.input,
                styles.borderBox,
                { color: theme.text, borderColor: theme.border },
              ]}
              placeholder="Ex: Table 1 ou Gradin Nord"
              placeholderTextColor={theme.textSecondary}
              value={newLayoutLabel}
              onChangeText={setNewLayoutLabel}
            />
          </View>

          {/* Gradin : colonnes × lignes = nombre de places */}
          {newLayoutType === "GRADIN" && (
            <View style={styles.rowInput}>
              <View style={[styles.inputGroup, styles.flex1MR8]}>
                <AppText variant="caption" color={theme.textSecondary}>
                  Colonnes
                </AppText>
                <TextInput
                  accessibilityLabel="Nombre de colonnes"
                  style={[styles.ticketingInput, { color: theme.text }]}
                  keyboardType="numeric"
                  placeholder="4"
                  placeholderTextColor={theme.textSecondary}
                  value={newLayoutCols}
                  onChangeText={setNewLayoutCols}
                />
              </View>
              <View style={[styles.inputGroup, styles.flex1]}>
                <AppText variant="caption" color={theme.textSecondary}>
                  Lignes (rangs)
                </AppText>
                <TextInput
                  accessibilityLabel="Nombre de lignes"
                  style={[styles.ticketingInput, { color: theme.text }]}
                  keyboardType="numeric"
                  placeholder="3"
                  placeholderTextColor={theme.textSecondary}
                  value={newLayoutRows}
                  onChangeText={setNewLayoutRows}
                />
              </View>
            </View>
          )}
          {newLayoutType === "GRADIN" && (
            <AppText
              variant="caption"
              style={[styles.negMt8Mb8, { color: theme.textSecondary }]}
            >
              {(parseInt(newLayoutRows, 10) || 0) *
                (parseInt(newLayoutCols, 10) || 0)}{" "}
              places
            </AppText>
          )}

          {/* Table : nombre de places */}
          {newLayoutType === "TABLE" && (
            <View style={[styles.inputGroup, styles.mt16]}>
              <AppText variant="caption" color={theme.textSecondary}>
                Nombre de places
              </AppText>
              <TextInput
                accessibilityLabel="Nombre de places à la table"
                style={[styles.ticketingInput, { color: theme.text }]}
                placeholder="8"
                keyboardType="numeric"
                placeholderTextColor={theme.textSecondary}
                value={newLayoutCapacity}
                onChangeText={setNewLayoutCapacity}
              />
            </View>
          )}

          {/* Autre : capacité */}
          {newLayoutType === "OTHER" && (
            <View style={[styles.inputGroup, styles.mt16]}>
              <AppText variant="caption" color={theme.textSecondary}>
                Capacité (places)
              </AppText>
              <TextInput
                accessibilityLabel="Capacité"
                style={[styles.ticketingInput, { color: theme.text }]}
                placeholder="8"
                keyboardType="numeric"
                placeholderTextColor={theme.textSecondary}
                value={newLayoutCapacity}
                onChangeText={setNewLayoutCapacity}
              />
            </View>
          )}

          <View style={[styles.inputGroup, styles.mt16]}>
            <AppText variant="caption" color={theme.textSecondary}>
              Rotation (°)
            </AppText>
            <TextInput
              accessibilityLabel="Rotation de l'élément en degrés"
              style={[styles.ticketingInput, { color: theme.text }]}
              keyboardType="numeric"
              placeholder="0"
              placeholderTextColor={theme.textSecondary}
              value={newLayoutRotation}
              onChangeText={setNewLayoutRotation}
            />
          </View>

          {/* Position et taille : uniquement en édition */}
          {editingLayoutItem && (
            <>
              <View style={styles.rowInput}>
                <View style={[styles.inputGroup, styles.flex1MR8]}>
                  <AppText variant="caption" color={theme.textSecondary}>
                    Position X (%)
                  </AppText>
                  <TextInput
                    accessibilityLabel="Position X"
                    style={[styles.ticketingInput, { color: theme.text }]}
                    keyboardType="numeric"
                    value={newLayoutX.toString()}
                    onChangeText={(v) => setNewLayoutX(parseInt(v, 10) || 0)}
                  />
                </View>
                <View style={[styles.inputGroup, styles.flex1]}>
                  <AppText variant="caption" color={theme.textSecondary}>
                    Position Y (%)
                  </AppText>
                  <TextInput
                    accessibilityLabel="Position Y"
                    style={[styles.ticketingInput, { color: theme.text }]}
                    keyboardType="numeric"
                    value={newLayoutY.toString()}
                    onChangeText={(v) => setNewLayoutY(parseInt(v, 10) || 0)}
                  />
                </View>
              </View>
              <View style={styles.rowInput}>
                <View style={[styles.inputGroup, styles.flex1MR8]}>
                  <AppText variant="caption" color={theme.textSecondary}>
                    Largeur (%)
                  </AppText>
                  <TextInput
                    accessibilityLabel="Largeur"
                    style={[styles.ticketingInput, { color: theme.text }]}
                    keyboardType="numeric"
                    value={newLayoutWidth.toString()}
                    onChangeText={(v) =>
                      setNewLayoutWidth(parseInt(v, 10) || 0)
                    }
                  />
                </View>
                <View style={[styles.inputGroup, styles.flex1]}>
                  <AppText variant="caption" color={theme.textSecondary}>
                    Hauteur (%)
                  </AppText>
                  <TextInput
                    accessibilityLabel="Hauteur"
                    style={[styles.ticketingInput, { color: theme.text }]}
                    keyboardType="numeric"
                    value={newLayoutHeight.toString()}
                    onChangeText={(v) =>
                      setNewLayoutHeight(parseInt(v, 10) || 0)
                    }
                  />
                </View>
              </View>
            </>
          )}

          <View style={styles.modalRow}>
            {editingLayoutItem && (
              <AppButton
                title="Supprimer"
                variant="danger"
                onPress={() => {
                  removeLayoutItem(editingLayoutItem.id);
                  setShowLayoutModal(false);
                }}
                style={styles.modalAction}
              />
            )}
            <AppButton
              title="Annuler"
              variant="secondary"
              onPress={() => setShowLayoutModal(false)}
              style={styles.flex1}
            />
            <AppButton
              title={editingLayoutItem ? "Modifier" : "Ajouter"}
              variant="primary"
              onPress={addLayoutItem}
              style={styles.flex2}
            />
          </View>
        </View>
      </View>
    </Modal>

    {/* Volunteer Access Modal */}
    <Modal
      visible={!!volunteerToken}
      transparent
      animationType="fade"
      onRequestClose={() => setVolunteerToken(null)}
    >
      <View style={styles.modalOverlay}>
        <View
          style={[
            styles.modalContent,
            { backgroundColor: theme.surface },
            styles.minH400,
          ]}
        >
          <View style={styles.rowBetweenMB16}>
            <AppText variant="h3" style={{ color: theme.text }}>
              Accès Bénévole
            </AppText>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Fermer"
              accessibilityHint="Fermer la fenêtre d'accès bénévole"
              onPress={() => setVolunteerToken(null)}
            >
              <X color={theme.text} size={24} />
            </TouchableOpacity>
          </View>

          <AppText
            variant="body"
            style={[styles.mb24, { color: theme.textSecondary }]}
          >
            Le bénévole doit scanner ce QR code pour accéder à l'interface de
            check-in.
          </AppText>

          <View style={styles.qrContainer}>
            {volunteerToken && (
              <QRCode
                value={volunteerToken.accessUrl}
                size={200}
                color="#000"
                backgroundColor="#FFF"
              />
            )}
          </View>

          <View style={styles.mt24}>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Copier le lien d'accès"
              accessibilityHint="Copie l'URL d'accès bénévole dans le presse-papier"
              style={[
                styles.copyButton,
                { backgroundColor: `${theme.primary}20` },
              ]}
              onPress={() => {
                if (volunteerToken) {
                  Clipboard.setStringAsync(volunteerToken.accessUrl)
                    .then(() =>
                      Alert.alert("Succès", "Lien copié dans le presse-papier"),
                    )
                    .catch(() => {});
                }
              }}
            >
              <Copy color={theme.primary} size={20} />
              <AppText style={[styles.ml8w600, { color: theme.primary }]}>
                Copier le lien
              </AppText>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  </>
);
