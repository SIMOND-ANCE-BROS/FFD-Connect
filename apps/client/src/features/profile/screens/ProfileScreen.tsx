import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Award, CreditCard, IdCard } from "lucide-react-native";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StatusBar,
  StyleSheet,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { AppButton } from "../../../components/AppButton";
import { AppText } from "../../../components/AppText";
import { useTheme } from "../../../context/ThemeContext";
import { RootStackParamList } from "../../../navigation/types";
import api from "../../../services/api";
import type { CareerResult } from "../../../services/BackendService";
import { LicenseExpiryBanner } from "../../license/components/LicenseExpiryBanner";
import { formatDiscipline } from "../../../utils/discipline";

type Props = NativeStackScreenProps<RootStackParamList, "Profile">;

export const ProfileScreen = ({ navigation }: Props) => {
  const { theme: currentTheme } = useTheme();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [license, setLicense] = useState<{
    number: string;
    validUntil: string;
    category: string;
    clubName: string;
  } | null>(null);
  const [results, setResults] = useState<CareerResult[]>([]);

  const loadData = useCallback(async () => {
    try {
      const [licenseRes, careerRes] = await Promise.all([
        api
          .get<{
            number: string;
            validUntil: string;
            category: string;
            clubName: string;
          }>("/licenses/my")
          .catch(() => ({ data: null })),
        api.get<{ results: CareerResult[] }>("/career/me").catch(() => ({
          data: { results: [] as CareerResult[] },
        })),
      ]);
      const licenseData = licenseRes.data;
      const careerData = careerRes.data;
      setLicense(licenseData);
      setResults(careerData.results ?? []);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void loadData();
  }, [loadData]);

  if (loading) {
    return (
      <SafeAreaView
        style={[styles.container, { backgroundColor: currentTheme.background }]}
      >
        <ActivityIndicator
          size="large"
          color={currentTheme.primary}
          style={styles.loader}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: currentTheme.background }]}
    >
      <StatusBar
        barStyle={currentTheme.statusBarStyle}
        backgroundColor={currentTheme.background}
      />
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={currentTheme.primary}
          />
        }
      >
        <LicenseExpiryBanner
          validUntil={license?.validUntil}
          onPress={() => navigation.navigate("LicenseRenewal")}
        />

        {/* License Section */}
        <View style={styles.sectionHeader}>
          <CreditCard size={20} color={currentTheme.primary} />
          <AppText
            variant="h2"
            style={styles.sectionTitle}
            color={currentTheme.text}
          >
            Ma licence
          </AppText>
        </View>

        {license ? (
          <View
            style={[
              styles.licenseCard,
              {
                backgroundColor: currentTheme.surface,
                borderColor: currentTheme.border,
              },
            ]}
          >
            <AppText variant="h3" color={currentTheme.text}>
              {license.number}
            </AppText>
            <AppText
              variant="body"
              color={currentTheme.textSecondary}
              style={styles.licenseDetail}
            >
              {formatDiscipline(license.category)} — {license.clubName}
            </AppText>
            <View style={styles.expiryRow}>
              <AppText variant="caption" color={currentTheme.textSecondary}>
                {`Valide jusqu'au ${new Date(license.validUntil).toLocaleDateString("fr-FR")}`}
              </AppText>
            </View>
          </View>
        ) : (
          <View
            style={[
              styles.emptyCard,
              { backgroundColor: `${currentTheme.primary}10` },
            ]}
          >
            <IdCard size={32} color={currentTheme.primary} />
            <AppText
              variant="body"
              color={currentTheme.primary}
              style={styles.emptyText}
            >
              Aucune licence associée
            </AppText>
            {/* The license is attached through the document workflow
                (license + medical certificates, OCR, then approval
                upserts the license). The check-in scanner is an organizer
                tool and must never be reachable from here. */}
            <AppButton
              title="Ajouter ma licence"
              onPress={() => navigation.navigate("LicenseRenewal")}
              style={styles.addLicenseButton}
              accessibilityLabel="Ajouter ma licence"
              accessibilityHint="Déposer vos certificats pour associer votre licence"
            />
          </View>
        )}

        {/* Career Results Section */}
        <View style={[styles.sectionHeader, styles.sectionMargin]}>
          <Award size={20} color={currentTheme.primary} />
          <AppText
            variant="h2"
            style={styles.sectionTitle}
            color={currentTheme.text}
          >
            Résultats ({results.length})
          </AppText>
        </View>

        {results.length > 0 ? (
          results.slice(0, 20).map((result, index) => (
            <View
              key={`result-${index}`}
              style={[
                styles.resultCard,
                {
                  backgroundColor: currentTheme.surface,
                  borderColor: currentTheme.border,
                },
              ]}
            >
              <View style={styles.resultHeader}>
                <AppText variant="body" weight="600" color={currentTheme.text}>
                  {result.competition?.title ?? "Compétition"}
                </AppText>
                <AppText variant="caption" color={currentTheme.textSecondary}>
                  {result.competition?.date
                    ? new Date(result.competition.date).toLocaleDateString(
                        "fr-FR",
                      )
                    : ""}
                </AppText>
              </View>
              <AppText variant="caption" color={currentTheme.textSecondary}>
                {formatDiscipline(result.event?.category)} —{" "}
                {result.event?.ageGroup}
              </AppText>
              {result.ranking != null && (
                <AppText
                  variant="body"
                  weight="bold"
                  color={currentTheme.primary}
                  style={styles.rank}
                >
                  #{result.ranking}
                  {result.totalParticipants
                    ? ` sur ${result.totalParticipants}`
                    : ""}
                </AppText>
              )}
            </View>
          ))
        ) : (
          <View
            style={[
              styles.emptyCard,
              { backgroundColor: `${currentTheme.primary}10` },
            ]}
          >
            <AppText variant="body" color={currentTheme.textSecondary}>
              Aucun résultat pour le moment
            </AppText>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  loader: { flex: 1, justifyContent: "center" },
  scrollContent: { padding: 16, paddingBottom: 32 },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 12,
  },
  sectionTitle: { marginLeft: 8 },
  sectionMargin: { marginTop: 24 },
  licenseCard: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 16,
  },
  licenseDetail: { marginTop: 4 },
  expiryRow: { flexDirection: "row", alignItems: "center", marginTop: 8 },
  emptyCard: {
    borderRadius: 12,
    padding: 24,
    alignItems: "center",
  },
  emptyText: { marginTop: 8, marginBottom: 12 },
  addLicenseButton: { minWidth: 200 },
  resultCard: {
    borderRadius: 10,
    borderWidth: 1,
    padding: 12,
    marginBottom: 8,
  },
  resultHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  rank: { marginTop: 4 },
});
