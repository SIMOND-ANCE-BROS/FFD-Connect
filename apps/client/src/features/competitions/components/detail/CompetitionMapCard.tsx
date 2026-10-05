import { MapPin } from "lucide-react-native";
import React, { useState } from "react";
import { Alert, Image, Linking, Platform, View } from "react-native";
import { AppButton } from "../../../../components/AppButton";
import { AppText } from "../../../../components/AppText";
import { EXPO_PUBLIC_GOOGLE_MAPS_KEY } from "../../../../config";
import type { AppTheme } from "../../../../context/ThemeContext";
import type { Competition } from "../../context/CompetitionContext";
import { styles } from "./competition-detail.styles";

interface CompetitionMapCardProps {
  currentTheme: AppTheme;
  details: Competition;
}

export function CompetitionMapCard({
  currentTheme,
  details,
}: CompetitionMapCardProps) {
  // Repli affiché si la tuile statique Google échoue (clé absente ou mal
  // restreinte, réseau) : évite une zone grise cassée.
  const [mapFailed, setMapFailed] = useState(false);

  if (!details.latitude || !details.longitude) return null;

  return (
    <View style={[styles.mapCard, { backgroundColor: currentTheme.surface }]}>
      <View style={styles.mapContainer}>
        {mapFailed ? (
          <View
            style={[
              styles.mapFallback,
              { backgroundColor: currentTheme.background },
            ]}
          >
            <MapPin size={24} color={currentTheme.textSecondary} />
            <AppText
              variant="caption"
              weight="600"
              align="center"
              style={styles.mapFallbackTitle}
            >
              Carte indisponible
            </AppText>
            {details.location ? (
              <AppText variant="caption" align="center">
                {details.location}
              </AppText>
            ) : null}
          </View>
        ) : (
          <Image
            source={{
              uri: `https://maps.googleapis.com/maps/api/staticmap?center=${details.latitude},${details.longitude}&zoom=15&size=600x300&markers=color:red%7C${details.latitude},${details.longitude}&key=${EXPO_PUBLIC_GOOGLE_MAPS_KEY}`,
            }}
            style={styles.mapImage}
            resizeMode="cover"
            onError={() => setMapFailed(true)}
          />
        )}
      </View>
      <View style={styles.navigationRow}>
        <AppButton
          title="S'y rendre"
          variant="outline"
          onPress={() => {
            const lat = details.latitude;
            const lng = details.longitude;
            const label = details.title;

            const options = [
              {
                text: Platform.OS === "ios" ? "Apple Maps" : "Google Maps",
                onPress: () => {
                  const url = Platform.select({
                    ios: `maps://0,0?q=${label}&ll=${lat},${lng}`,
                    android: `geo:0,0?q=${lat},${lng}(${label})`,
                  });
                  if (url) Linking.openURL(url).catch(() => {});
                },
              },
              {
                text: "Google Maps",
                onPress: () => {
                  const url = `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
                  Linking.openURL(url).catch(() => {});
                },
              },
              {
                text: "Waze",
                onPress: () => {
                  const url = `https://waze.com/ul?ll=${lat},${lng}&navigate=yes`;
                  Linking.openURL(url).catch(() => {});
                },
              },
              {
                text: "Annuler",
                style: "cancel" as const,
              },
            ];

            Alert.alert(
              "Choisir une application GPS",
              "Laquelle souhaitez-vous utiliser ?",
              options,
              { cancelable: true },
            );
          }}
          style={styles.fullWidth}
        />
      </View>
    </View>
  );
}
