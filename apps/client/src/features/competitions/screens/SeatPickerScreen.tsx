import { NativeStackScreenProps } from "@react-navigation/native-stack";
import React, { useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, View } from "react-native";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import { AppButton } from "../../../components/AppButton";
import { AppText } from "../../../components/AppText";
import { BackButton } from "../../../components/BackButton";
import { PinnedHeader } from "../../../components/PinnedHeader";
import { useTheme, type AppTheme } from "../../../context/ThemeContext";
import { RootStackParamList } from "../../../navigation/types";
import {
  SEAT_SIZE,
  SeatPlanElementCard,
  seatColors,
} from "../components/seat/SeatPlanElementCard";
import { useSeatBooking, type SeatHold } from "../hooks/useSeatBooking";
import {
  formatHoldTime,
  formatPrice,
  seatStatus,
  type SeatStatus,
} from "../utils/seatPlan";

type Props = NativeStackScreenProps<RootStackParamList, "SeatPicker">;

const LEGEND: Array<{ status: SeatStatus; selected?: boolean; label: string }> =
  [
    { status: "free", label: "Libre" },
    { status: "free", selected: true, label: "Sélectionnée" },
    { status: "mineHeld", label: "Votre place" },
    { status: "taken", label: "Indisponible" },
  ];

const Legend = ({ theme }: { theme: AppTheme }) => (
  <View
    style={styles.legend}
    accessible
    accessibilityLabel="Légende : libre, sélectionnée, votre place, indisponible (prise, en cours de réservation ou fermée)"
    accessibilityHint="Couleurs utilisées sur le plan de salle"
  >
    {LEGEND.map(({ status, selected, label }) => {
      const colors = seatColors(status, !!selected, theme);
      return (
        <View key={label} style={styles.legendItem}>
          <View
            style={[
              styles.legendSwatch,
              {
                backgroundColor: colors.background,
                borderColor: colors.border,
              },
            ]}
          />
          <AppText variant="caption" color={theme.textSecondary}>
            {label}
          </AppText>
        </View>
      );
    })}
  </View>
);

function holdMessage(hold: SeatHold): string {
  const time = formatHoldTime(hold.expiresAt);
  const until = time ? ` jusqu'à ${time}` : "";
  return hold.resumed
    ? `Paiement repris : ${hold.label} vous reste réservée${until}.`
    : `${hold.label} vous est réservée${until}. Finalisez le paiement sur HelloAsso.`;
}

/**
 * Seat picker of a competition (#453): the user picks a free seat on the
 * plan (or a free-placement element), then pays on HelloAsso.
 */
export const SeatPickerScreen = ({ route, navigation }: Props) => {
  const { competitionId } = route.params;
  const { theme, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const [headerH, setHeaderH] = useState(insets.top + 56);
  const booking = useSeatBooking(competitionId);

  const header = (
    <PinnedHeader
      theme={theme}
      isDark={isDark}
      title="Choisir ma place"
      onHeightChange={setHeaderH}
      left={<BackButton onPress={() => navigation.goBack()} />}
    />
  );

  let body: React.ReactNode;
  if (booking.isLoading) {
    body = (
      <View style={[styles.center, { paddingTop: headerH }]}>
        <ActivityIndicator color={theme.primary} testID="seat-picker-loading" />
      </View>
    );
  } else if (booking.isError) {
    body = (
      <View style={[styles.center, { paddingTop: headerH }]}>
        <AppText
          variant="body"
          align="center"
          color={theme.text}
          style={styles.message}
        >
          Impossible de charger le plan de salle.
        </AppText>
        <AppButton
          title="Réessayer"
          variant="outline"
          onPress={booking.reload}
          testID="seat-picker-retry"
        />
      </View>
    );
  } else if (booking.elements.length === 0) {
    body = (
      <View style={[styles.center, { paddingTop: headerH }]}>
        <AppText
          variant="body"
          align="center"
          color={theme.textSecondary}
          testID="seat-picker-empty"
        >
          Aucune place n'est en vente pour cette compétition.
        </AppText>
      </View>
    );
  } else {
    body = (
      <ScrollView
        contentContainerStyle={{ paddingTop: headerH, paddingBottom: 16 }}
        testID="seat-picker-scroll"
      >
        {!!booking.competitionTitle && (
          <AppText
            variant="h3"
            color={theme.text}
            style={styles.title}
            accessibilityRole="header"
          >
            {booking.competitionTitle}
          </AppText>
        )}
        <Legend theme={theme} />
        {booking.hold && (
          <View
            style={[styles.hold, { borderColor: theme.success }]}
            accessibilityLiveRegion="polite"
            testID="seat-picker-hold"
          >
            <AppText variant="caption" color={theme.text}>
              {holdMessage(booking.hold)}
            </AppText>
          </View>
        )}
        {booking.elements.map((element) => (
          <SeatPlanElementCard
            key={element.id}
            element={element}
            selection={booking.selection}
            theme={theme}
            disabled={booking.isPaying}
            onSelectSeat={booking.selectSeat}
            onSelectFree={booking.selectFreeElement}
          />
        ))}
      </ScrollView>
    );
  }

  const selected = booking.selectedElement;
  const resuming =
    !!selected &&
    booking.selection?.seatIndex !== undefined &&
    seatStatus(selected, booking.selection.seatIndex) === "mineHeld";
  const price =
    selected && selected.priceCents !== null
      ? formatPrice(selected.priceCents)
      : "";

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: theme.background }]}
      edges={["left", "right"]}
    >
      {body}
      {selected && booking.selectedLabel && (
        <View
          style={[
            styles.footer,
            {
              backgroundColor: theme.surface,
              borderTopColor: theme.border,
              paddingBottom: Math.max(insets.bottom, 12),
            },
          ]}
          testID="seat-picker-footer"
        >
          <AppText
            variant="body"
            weight="600"
            color={theme.text}
            style={styles.footerLabel}
          >
            {booking.selectedLabel}
          </AppText>
          <AppButton
            title={
              resuming ? `Reprendre le paiement (${price})` : `Payer ${price}`
            }
            onPress={booking.pay}
            loading={booking.isPaying}
            disabled={booking.isPaying}
            accessibilityLabel={
              resuming
                ? `Reprendre le paiement de ${booking.selectedLabel}, ${price}`
                : `Payer ${booking.selectedLabel}, ${price}, sur HelloAsso`
            }
            accessibilityHint="Ouvre la page de paiement HelloAsso"
            testID="seat-picker-pay"
          />
        </View>
      )}
      {header}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  message: {
    marginBottom: 16,
  },
  title: {
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 8,
  },
  legend: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginHorizontal: 16,
    marginBottom: 12,
  },
  legendItem: {
    flexDirection: "row",
    alignItems: "center",
    marginRight: 14,
    marginBottom: 6,
  },
  legendSwatch: {
    width: SEAT_SIZE / 2,
    height: SEAT_SIZE / 2,
    borderRadius: 4,
    borderWidth: 1.5,
    marginRight: 6,
  },
  hold: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
    marginHorizontal: 16,
    marginBottom: 12,
  },
  footer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  footerLabel: {
    marginBottom: 8,
  },
});
