import { Bell } from "lucide-react-native";
import React from "react";
import { StyleSheet, TouchableOpacity, View } from "react-native";
import { AppText } from "./AppText";
import { AppTheme } from "../context/ThemeContext";
import { useUnreadNotificationsCount } from "../features/settings/hooks/useUnreadNotificationsCount";

interface NotificationBellProps {
  theme: AppTheme;
  onPress: () => void;
  /** Compter les non-lus (false pour les invités → pas de token). */
  enabled?: boolean;
  color?: string;
  /** Applique le fond adapté au thème (comme les autres boutons d'en-tête). */
  isDark?: boolean;
}

/**
 * Cloche de notifications + badge non-lus (#546 lot A) — point d'entrée du
 * centre de notifications, réutilisable dans les en-têtes de tous les profils.
 * Même habillage (cercle bordé 44×44) que les autres boutons d'en-tête pour
 * rester cohérent dans toute l'app.
 */
export const NotificationBell = ({
  theme,
  onPress,
  enabled = true,
  color,
  isDark = false,
}: NotificationBellProps) => {
  const unread = useUnreadNotificationsCount(enabled);
  const iconColor = color ?? theme.text;

  return (
    <TouchableOpacity
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={
        unread > 0
          ? `Notifications, ${unread} non lue${unread > 1 ? "s" : ""}`
          : "Notifications"
      }
      accessibilityHint="Ouvre le centre de notifications"
      testID="notification-bell"
      style={[
        styles.button,
        {
          borderColor: theme.border,
          backgroundColor: isDark ? "rgba(255,255,255,0.05)" : "#F5F5F5",
        },
      ]}
      hitSlop={8}
    >
      <Bell size={22} color={iconColor} />
      {unread > 0 && (
        <View
          style={[styles.badge, { backgroundColor: theme.danger }]}
          testID="notification-bell-badge"
        >
          <AppText variant="caption" color="#fff" style={styles.badgeText}>
            {unread > 9 ? "9+" : String(unread)}
          </AppText>
        </View>
      )}
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  button: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  badge: {
    position: "absolute",
    top: 2,
    right: 2,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    paddingHorizontal: 3,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: {
    fontSize: 10,
    fontWeight: "700",
    lineHeight: 14,
  },
});
