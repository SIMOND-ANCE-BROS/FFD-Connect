import { Heart, Music, Search, WifiOff } from "lucide-react-native";
import React from "react";
import { View } from "react-native";
import { AppText } from "../../../../components/AppText";
import { AppTheme } from "../../../../context/ThemeContext";
import { libraryStyles as styles } from "./library.styles";

interface LibraryEmptyStateProps {
  currentTheme: AppTheme;
  activeTab: "default" | "style" | "likes";
  searchQuery: string;
  /** Offline with nothing loaded: say so instead of "bibliothèque vide". */
  isOffline?: boolean;
}

const getEmptyMessage = (
  activeTab: string,
  searchQuery: string,
  currentTheme: AppTheme,
  isOffline: boolean,
) => {
  if (isOffline && activeTab !== "likes" && !searchQuery) {
    return {
      title: "Hors ligne",
      subtitle:
        "La bibliothèque n'a pas pu être chargée. Reconnectez-vous pour l'afficher.",
      icon: <WifiOff size={48} color={currentTheme.textSecondary} />,
    };
  }
  if (searchQuery) {
    return {
      title: "Aucun résultat",
      subtitle: "Aucune musique ne correspond à votre recherche.",
      icon: <Search size={48} color={currentTheme.textSecondary} />,
    };
  }

  switch (activeTab) {
    case "style":
      return {
        title: "Aucune danse",
        subtitle: "Aucun style de danse n'est disponible.",
        icon: <Music size={48} color={currentTheme.textSecondary} />,
      };
    case "likes":
      return {
        title: "Aucun favori",
        subtitle: "Ajoutez des titres aux favoris \u2764\uFE0F",
        icon: <Heart size={48} color={currentTheme.textSecondary} />,
      };
    default:
      return {
        title: "Aucun résultat",
        subtitle: "Votre bibliothèque est vide.",
        icon: <Music size={48} color={currentTheme.textSecondary} />,
      };
  }
};

export const LibraryEmptyState = ({
  currentTheme,
  activeTab,
  searchQuery,
  isOffline = false,
}: LibraryEmptyStateProps) => {
  const emptyState = getEmptyMessage(
    activeTab,
    searchQuery,
    currentTheme,
    isOffline,
  );

  return (
    <View style={styles.emptyContainer}>
      <View style={styles.emptyIconWrapper}>{emptyState.icon}</View>
      <AppText
        variant="h3"
        align="center"
        color={currentTheme.text}
        style={styles.emptyTitle}
      >
        {emptyState.title}
      </AppText>
      <AppText variant="body" align="center" color={currentTheme.textSecondary}>
        {emptyState.subtitle}
      </AppText>
    </View>
  );
};
