import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Share, User, WifiOff } from "lucide-react-native";
import React, { useRef, useState } from "react";
import {
  Animated,
  Modal,
  Platform,
  StatusBar,
  StyleSheet,
  TouchableOpacity,
  UIManager,
  View,
} from "react-native";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import { QRCodeView } from "../components/QRCodeView.native";

import { AppText } from "../../../components/AppText";
import { BetaNotice } from "../../../components/BetaNotice";
import { BETA_NOTICES } from "../../../constants/betaNotices";
import {
  GlassHeader,
  GLASS_HEADER_HEIGHT,
} from "../../../components/GlassHeader";
import { NotificationBell } from "../../../components/NotificationBell";
import {
  StackedCard,
  STACKED_CARD_ACTIVE_OFFSET,
} from "../../../components/StackedCard";
import { AddLicenseCard } from "../components/AddLicenseCard";
import { AddToAppleWalletButton } from "../components/AddToAppleWalletButton";
import { BigBarcode } from "../components/BigBarcode";
import {
  LicenseCard,
  LicenseType,
  LicenseUser,
} from "../components/LicenseCard";
import { LicenseExpiryBanner } from "../components/LicenseExpiryBanner";
import { computeLicenseExpiry } from "../utils/licenseExpiry";
import { SwipeableLicenseCard } from "../components/SwipeableLicenseCard";
import { WdsfEntryModal } from "../components/WdsfEntryModal";

import { useTheme } from "../../../context/ThemeContext";
import type { RootStackParamList } from "../../../navigation/types";
import { isWdsfQrData } from "../../../utils/typeGuards";
import { useLicenseLogic } from "../hooks/useLicenseLogic";
import { buildLicenseQrData } from "../utils/licenseQrData";

if (Platform.OS === "android") {
  if (UIManager.setLayoutAnimationEnabledExperimental) {
    UIManager.setLayoutAnimationEnabledExperimental(true);
  }
}

/**
 * Bottom clearance for the floating tab bar (70pt pill + its own bottom gap)
 * and the mini player that can sit above it — same budget as the other tab
 * root screens. Without it the end of the content hides behind the tab bar.
 */
const FLOATING_TAB_BAR_CLEARANCE = 120;

type LicenseListItem = { type: string; data: LicenseUser | null };

export const LicenseScreen: React.FC = () => {
  const { state, actions } = useLicenseLogic();
  const { theme: currentTheme, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const scrollY = useRef(new Animated.Value(0)).current;
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [addWdsfOrigin, setAddWdsfOrigin] = useState<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);

  const ffdUser =
    state.listItems.find((item) => item.type === "FFD")?.data ?? null;
  const ffdValidUntilRaw = ffdUser?.validUntilRaw ?? null;

  // FFD/WDSF card (WDSF wrapped for swipe-to-remove) in the stacked wallet.
  const renderLicenseCard = (item: LicenseListItem, collapsed: boolean) => {
    const user = item.data as LicenseUser;
    if (item.type === "WDSF") {
      return (
        <SwipeableLicenseCard
          onRemove={actions.handleRemoveWdsfWithConfirm}
          enabled={!collapsed}
          theme={currentTheme}
        >
          <LicenseCard
            type="WDSF"
            user={user}
            photoUri={state.photoUri}
            onShowQr={() =>
              actions.handleShowQr(
                JSON.stringify({
                  id: item.data?.licenseNumber,
                  valid: true,
                  type: item.type,
                }),
              )
            }
            themeOverride={isDark ? "dark" : "light"}
            collapsed={collapsed}
            onOptions={actions.handleRemoveWdsfWithConfirm}
            testID="license-card-WDSF"
          />
        </SwipeableLicenseCard>
      );
    }
    return (
      <LicenseCard
        type={item.type as LicenseType}
        user={user}
        photoUri={state.photoUri}
        onShowQr={() =>
          actions.handleShowQr(
            // QR signé par le serveur (#168) tel quel, sinon
            // ancien contenu (backend ancien / snapshot antérieur).
            buildLicenseQrData(user, item.type),
          )
        }
        themeOverride={isDark ? "dark" : "light"}
        collapsed={collapsed}
        testID={`license-card-${item.type}`}
      />
    );
  };

  const activeItemType = state.listItems[state.activeCardIndex]?.type;
  const isGuest = state.listItems.some((item) => item.type === "GUEST");

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: currentTheme.background }]}
      edges={["left", "right"]}
    >
      <StatusBar
        barStyle={currentTheme.statusBarStyle}
        backgroundColor={currentTheme.background}
      />

      <GlassHeader
        theme={currentTheme}
        isDark={isDark}
        title="Mes licences"
        scrollY={scrollY}
        right={
          <View style={styles.headerActions}>
            {/* Le renouvellement se fait via la bannière d'expiration (cliquable)
                affichée quand la licence approche/à échéance. Plus de bouton
                dédié dans l'en-tête (redondant). */}
            <TouchableOpacity
              accessibilityRole="button"
              testID="license-screen-share-button"
              onPress={() => {
                actions.generateAndSharePdf().catch(() => {});
              }}
              disabled={state.loadingPdf}
              style={[
                styles.shareIcon,
                isDark ? styles.iconBoxDark : styles.iconBoxLight,
                { borderColor: currentTheme.border },
              ]}
            >
              <Share size={22} color={currentTheme.text} />
            </TouchableOpacity>
            <NotificationBell
              theme={currentTheme}
              isDark={isDark}
              onPress={() => navigation.getParent()?.navigate("Notifications")}
            />
          </View>
        }
      />

      <Animated.ScrollView
        contentContainerStyle={[
          {
            paddingTop: insets.top + GLASS_HEADER_HEIGHT + 8,
            paddingBottom: insets.bottom + FLOATING_TAB_BAR_CLEARANCE,
          },
        ]}
        style={styles.mainContainer}
        testID="license-screen-scroll-view"
        scrollEventThrottle={16}
        onScroll={Animated.event(
          [{ nativeEvent: { contentOffset: { y: scrollY } } }],
          { useNativeDriver: true },
        )}
      >
        <AppText
          variant="caption"
          color={currentTheme.textSecondary}
          style={styles.seasonSubtitle}
        >
          Saison 2025-2026
        </AppText>
        {/* Mode hors-ligne (#416) : licence servie depuis le snapshot local,
            validité recalculée localement (vert/rouge). */}
        {state.offlineSince ? (
          <View
            style={[
              offlineStyles.banner,
              { backgroundColor: `${currentTheme.textSecondary}18` },
            ]}
            testID="license-offline-banner"
          >
            <View
              style={[
                offlineStyles.dot,
                {
                  backgroundColor:
                    computeLicenseExpiry(ffdValidUntilRaw).status !== "expired"
                      ? "#2ecc71"
                      : "#e74c3c",
                },
              ]}
            />
            <AppText variant="caption" color={currentTheme.textSecondary}>
              Hors ligne — licence enregistrée le{" "}
              {new Date(state.offlineSince).toLocaleDateString("fr-FR")}
            </AppText>
          </View>
        ) : null}
        {/* No network and no local snapshot (never loaded online on this
            device): say so explicitly instead of an empty wallet. */}
        {state.licenseUnavailable && !ffdUser ? (
          <View
            style={[
              offlineStyles.unavailable,
              {
                backgroundColor: currentTheme.surface,
                borderColor: currentTheme.border,
              },
            ]}
            testID="license-unavailable"
            accessibilityRole="alert"
          >
            <WifiOff size={36} color={currentTheme.textSecondary} />
            <AppText
              variant="h3"
              align="center"
              color={currentTheme.text}
              style={offlineStyles.unavailableTitle}
            >
              Licence indisponible
            </AppText>
            <AppText
              variant="body"
              align="center"
              color={currentTheme.textSecondary}
            >
              Impossible de charger votre licence et aucune copie n'est
              enregistrée sur cet appareil. Connectez-vous à internet puis
              rouvrez cet écran : elle restera ensuite consultable hors ligne.
            </AppText>
          </View>
        ) : null}
        <LicenseExpiryBanner
          validUntil={ffdValidUntilRaw}
          onPress={() => navigation.getParent()?.navigate("LicenseRenewal")}
        />
        {/* Beta: the displayed license (and its Wallet pass) is not yet
            accepted at competitions — shown above the cards and the
            Apple Wallet button. */}
        {isGuest ? null : (
          <BetaNotice
            title={BETA_NOTICES.license.title}
            message={BETA_NOTICES.license.message}
            style={styles.betaNotice}
            testID="license-beta-notice"
          />
        )}
        <View style={styles.walletContainer} testID="license-screen-wallet">
          {state.listItems.map((item, index) => {
            const isActive = index === state.activeCardIndex;

            if (item.type === "ADD_WDSF") {
              return (
                <StackedCard
                  key="add-wdsf"
                  index={index}
                  isActive={isActive}
                  pullY={state.pullY}
                  pullGesture={state.pullGesture}
                  isPullable={false}
                  onPress={actions.handleAddWdsf}
                  testID="license-screen-add-wdsf-card"
                >
                  <AddLicenseCard
                    pullY={state.pullY}
                    theme={currentTheme}
                    onPlusLayout={setAddWdsfOrigin}
                  />
                </StackedCard>
              );
            }

            if (item.type === "GUEST") {
              return (
                <StackedCard
                  key="guest"
                  index={index}
                  isActive={isActive}
                  pullY={state.pullY}
                  pullGesture={state.pullGesture}
                  isPullable={false}
                  onPress={() => {}}
                  testID="license-screen-guest-card"
                >
                  <View
                    style={[
                      styles.guestCard,
                      {
                        backgroundColor: currentTheme.surface,
                        borderColor: currentTheme.border,
                      },
                    ]}
                  >
                    <View
                      style={[
                        styles.guestIconBox,
                        isDark
                          ? styles.guestIconBoxDark
                          : styles.guestIconBoxLight,
                      ]}
                    >
                      <User size={32} color={currentTheme.textSecondary} />
                    </View>
                    <AppText
                      variant="h2"
                      align="center"
                      style={[styles.guestTitle]}
                    >
                      Mode Invité
                    </AppText>
                    <AppText variant="body" align="center">
                      Vous consultez l'application en tant qu'invité.
                      Connectez-vous avec votre licence pour accéder à toutes
                      les fonctionnalités.
                    </AppText>
                  </View>
                </StackedCard>
              );
            }

            if (item.type === "STAFF") {
              return (
                <StackedCard
                  key="staff"
                  index={index}
                  isActive={isActive}
                  pullY={state.pullY}
                  pullGesture={state.pullGesture}
                  isPullable={false}
                  onPress={() => actions.handleCardPress(index)}
                  testID="license-screen-staff-card"
                >
                  <LicenseCard
                    type="FFD"
                    user={item.data as LicenseUser}
                    photoUri={state.photoUri}
                    onShowQr={() =>
                      actions.handleShowQr(
                        JSON.stringify({
                          id: item.data?.licenseNumber,
                          valid: true,
                          type: "STAFF",
                          role: "STAFF",
                        }),
                      )
                    }
                    themeOverride={isDark ? "dark" : "light"}
                    collapsed={!isActive}
                    testID={`license-card-${index}`}
                  />
                </StackedCard>
              );
            }

            const isPullable =
              item.type === "FFD" && !state.showWdsf && isActive;

            return (
              <StackedCard
                key={index}
                index={index}
                isActive={isActive}
                pullY={state.pullY}
                pullGesture={state.pullGesture}
                isPullable={isPullable}
                onPress={() => actions.handleCardPress(index)}
                testID={`license-screen-card-${item.type}`}
              >
                {renderLicenseCard(item, !isActive)}
              </StackedCard>
            );
          })}
        </View>
        {/* Apple Wallet (#163): FFD license only — hidden while the WDSF
            card is the active one of the stack. */}
        {ffdUser && activeItemType !== "WDSF" ? (
          <AddToAppleWalletButton
            license={ffdUser}
            servedFromSnapshot={Boolean(state.offlineSince)}
          />
        ) : null}
      </Animated.ScrollView>

      <WdsfEntryModal
        visible={state.wdsfModalVisible}
        onClose={() => actions.setWdsfModalVisible(false)}
        onVerify={(min: string) => {
          actions.handleVerifyWdsf(min).catch(() => {});
        }}
        loading={state.verifyingWdsf}
        error={state.wdsfError}
        theme={currentTheme}
        testID="wdsf-entry-modal"
        origin={addWdsfOrigin}
      />

      <Modal
        visible={state.showQr}
        transparent={true}
        animationType="fade"
        onRequestClose={() => actions.setShowQr(false)}
        testID="qr-code-modal"
      >
        <TouchableOpacity
          accessibilityRole="button"
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => actions.setShowQr(false)}
          testID="qr-modal-overlay"
        >
          <View
            style={[
              styles.qrModalContent,
              { backgroundColor: currentTheme.surface },
            ]}
          >
            {isWdsfQrData(state.activeQrData) ? (
              <BigBarcode value={state.activeQrData.id ?? ""} />
            ) : (
              <View style={styles.qrCodeContainer}>
                <QRCodeView
                  value={JSON.stringify(state.activeQrData)}
                  size={220}
                />
              </View>
            )}
            <TouchableOpacity
              accessibilityRole="button"
              onPress={() => actions.setShowQr(false)}
              style={styles.modalCloseButton}
              testID="qr-modal-close-button"
            >
              <AppText variant="button">Fermer</AppText>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  seasonSubtitle: {
    paddingHorizontal: 20,
    marginBottom: 10,
  },
  betaNotice: {
    marginHorizontal: 20,
    marginBottom: 12,
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  walletContainer: {
    marginTop: 10,
    paddingHorizontal: 20,
    // The active StackedCard is shifted down with `top`, which does not grow
    // this container: reserve that offset so its bottom stays scrollable.
    // Its height then follows the (compact) active card instead of a fixed
    // minimum, so the Apple Wallet button sits right under the stack.
    paddingBottom: STACKED_CARD_ACTIVE_OFFSET,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.2)",
    justifyContent: "center",
    alignItems: "center",
  },
  qrModalContent: {
    padding: 30,
    borderRadius: 24,
    alignItems: "center",
    width: "90%",
  },
  mainContainer: {
    flex: 1,
  },
  qrCodeContainer: {
    padding: 20,
    backgroundColor: "white",
    borderRadius: 20,
    marginBottom: 20,
  },
  modalCloseButton: {
    padding: 10,
  },
  guestCard: {
    padding: 24,
    borderRadius: 24,
    alignItems: "center",
    borderWidth: 1,
    minHeight: 280,
    justifyContent: "center",
  },
  guestIconBox: {
    width: 64,
    height: 64,
    borderRadius: 32,
    marginBottom: 16,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
  },
  guestTitle: {
    marginBottom: 8,
  },
  shareIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
  },
  iconBoxLight: {
    backgroundColor: "#F5F5F5",
  },
  iconBoxDark: {
    backgroundColor: "rgba(255,255,255,0.05)",
  },
  guestIconBoxLight: {
    backgroundColor: "#F0F0F0",
  },
  guestIconBoxDark: {
    backgroundColor: "rgba(255,255,255,0.1)",
  },
});

const offlineStyles = StyleSheet.create({
  banner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 10,
    marginBottom: 10,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  unavailable: {
    alignItems: "center",
    gap: 8,
    marginHorizontal: 20,
    marginBottom: 16,
    padding: 24,
    borderRadius: 16,
    borderWidth: 1,
  },
  unavailableTitle: { marginTop: 4 },
});
