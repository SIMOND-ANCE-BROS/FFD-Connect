import { Users } from "lucide-react-native";
import React from "react";
import { TouchableOpacity, View } from "react-native";
import { AppText } from "../../../../components/AppText";
import type { AppTheme } from "../../../../context/ThemeContext";
import type { Partnership } from "../../services/ClubService";
import { styles } from "./club-couples.styles";

interface CoupleCardProps {
  theme: AppTheme;
  item: Partnership;
  activeOnly: boolean;
  myClubId: string | null;
  onEnd: (p: Partnership) => void;
  onValidate: (partnershipId: string, accepted: boolean) => void;
}

const name = (u: { firstName: string; lastName: string }) =>
  `${u.firstName} ${u.lastName}`;

export const CoupleCard = React.memo(function CoupleCard({
  theme,
  item,
  activeOnly,
  myClubId,
  onEnd,
  onValidate,
}: CoupleCardProps) {
  const isPendingSecondary =
    item.status === "PENDING_SECOND_CLUB" && item.secondaryClubId === myClubId;
  const canEnd = activeOnly && item.status === "ACTIVE";

  return (
    <View style={[styles.card, { backgroundColor: theme.surface }]}>
      <View style={[styles.avatar, { backgroundColor: theme.primary }]}>
        <Users size={22} color="#fff" />
      </View>
      <View style={styles.cardBody}>
        <AppText variant="body" style={[styles.bold, { color: theme.text }]}>
          {name(item.user1)} & {name(item.user2)}
        </AppText>
        <AppText variant="caption" style={{ color: theme.textSecondary }}>
          Depuis le {new Date(item.startDate).toLocaleDateString("fr-FR")}
          {item.endDate &&
            ` • Fin le ${new Date(item.endDate).toLocaleDateString("fr-FR")}`}
          {item.secondaryClub && ` • ${item.secondaryClub.name}`}
        </AppText>
        {item.status === "PENDING_SECOND_CLUB" && (
          <AppText
            variant="caption"
            style={[styles.mt2, { color: theme.primary }]}
          >
            En attente validation partenaire
          </AppText>
        )}
        {item.status === "REJECTED" && (
          <AppText
            variant="caption"
            style={[styles.mt2, { color: theme.textSecondary }]}
          >
            Refusé par le club partenaire
          </AppText>
        )}
      </View>
      {activeOnly && isPendingSecondary && (
        <View style={styles.gap6}>
          <TouchableOpacity
            onPress={() => {
              onValidate(item.id, true);
            }}
            style={[styles.endButton, { borderColor: theme.primary }]}
            accessibilityRole="button"
            accessibilityLabel="Valider le partenariat"
            accessibilityHint="Accepte la demande de partenariat inter-club"
          >
            <AppText variant="caption" style={{ color: theme.primary }}>
              Valider
            </AppText>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => {
              onValidate(item.id, false);
            }}
            style={[styles.endButton, { borderColor: theme.textSecondary }]}
            accessibilityRole="button"
            accessibilityLabel="Refuser le partenariat"
            accessibilityHint="Refuse la demande de partenariat inter-club"
          >
            <AppText variant="caption" style={{ color: theme.textSecondary }}>
              Refuser
            </AppText>
          </TouchableOpacity>
        </View>
      )}
      {activeOnly && canEnd && (
        <TouchableOpacity
          onPress={() => onEnd(item)}
          style={[styles.endButton, { borderColor: theme.textSecondary }]}
          accessibilityRole="button"
          accessibilityLabel="Clôturer le partenariat"
          accessibilityHint="Met fin au partenariat entre les deux danseurs"
        >
          <AppText variant="caption" style={{ color: theme.textSecondary }}>
            Clôturer
          </AppText>
        </TouchableOpacity>
      )}
    </View>
  );
});
