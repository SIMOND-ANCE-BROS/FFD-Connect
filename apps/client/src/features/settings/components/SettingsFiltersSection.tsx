import { ListMusic, Trophy } from "lucide-react-native";
import React from "react";
import { Text, View } from "react-native";
import { FluidSegmentedTab } from "../../../components/FluidSegmentedTab";
import { AppTheme } from "../../../context/ThemeContext";
import { styles } from "./settings.styles";

interface SettingsFiltersSectionProps {
  theme: AppTheme;
  defaultFilter: string;
  handleSetLibraryFilter: (value: string) => Promise<void>;
  defaultCompetitionScope: string;
  handleSetCompetitionScope: (value: string) => Promise<void>;
  defaultCompetitionStatus: string;
  handleSetCompetitionStatus: (value: string) => Promise<void>;
}

export const SettingsFiltersSection: React.FC<SettingsFiltersSectionProps> = ({
  theme,
  defaultFilter,
  handleSetLibraryFilter,
  defaultCompetitionScope,
  handleSetCompetitionScope,
  defaultCompetitionStatus,
  handleSetCompetitionStatus,
}) => (
  <>
    <View style={styles.sectionTitleContainer}>
      <Text style={[styles.sectionTitle, { color: theme.textSecondary }]}>
        Filtres
      </Text>
    </View>

    <View style={[styles.card, { backgroundColor: theme.surface }]}>
      {/* Library Filters */}
      <View style={[styles.row, styles.noPaddingBottom]}>
        <View style={styles.rowLeft}>
          <View style={[styles.iconBox, styles.libraryIconBox]}>
            <ListMusic size={18} color="#FFD700" />
          </View>
          <Text style={[styles.rowLabel, { color: theme.text }]}>
            Bibliothèque
          </Text>
        </View>
      </View>

      <View style={styles.tabContainer}>
        <FluidSegmentedTab
          activeValue={defaultFilter}
          onChange={(v) => {
            handleSetLibraryFilter(v).catch(() => {});
          }}
          testID="settings-library-filter-tab"
          options={[
            { label: "Tout", value: "default" },
            { label: "Danses", value: "style" },
            { label: "Favoris", value: "likes" },
          ]}
        />
      </View>

      {/* Competition Filter */}
      <View
        style={[
          styles.row,
          styles.noPaddingBottom,
          styles.borderTop,
          { borderTopColor: theme.border },
        ]}
      >
        <View style={styles.rowLeft}>
          <View style={[styles.iconBox, styles.competitionIconBox]}>
            <Trophy size={18} color="#FF6464" />
          </View>
          <Text style={[styles.rowLabel, { color: theme.text }]}>
            Compétition
          </Text>
        </View>
      </View>

      <View style={styles.tabContainer}>
        <View style={styles.marginBottom12}>
          <FluidSegmentedTab
            activeValue={defaultCompetitionScope}
            onChange={(v) => {
              handleSetCompetitionScope(v).catch(() => {});
            }}
            testID="settings-competition-scope-tab"
            options={[
              { label: "Toutes", value: "all" },
              { label: "Pour moi", value: "registrant" },
            ]}
          />
        </View>
        <FluidSegmentedTab
          activeValue={defaultCompetitionStatus}
          onChange={(v) => {
            handleSetCompetitionStatus(v).catch(() => {});
          }}
          testID="settings-competition-status-tab"
          options={[
            { label: "À venir", value: "UPCOMING" },
            { label: "En cours", value: "LIVE" },
            { label: "Passées", value: "PAST" },
            { label: "Tout", value: "ALL" },
          ]}
        />
      </View>
    </View>
  </>
);
