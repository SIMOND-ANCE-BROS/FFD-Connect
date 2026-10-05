import { ClipboardList, Trophy, User, Users } from "lucide-react-native";
import type { LucideIcon } from "lucide-react-native";
import { TeamIcon } from "../../components/icons/TeamIcon";

export type ClubDashboardWidgetId =
  | "members"
  | "registrations"
  | "competitions"
  | "couples"
  | "soloTeams";

export interface ClubDashboardWidgetDefinition {
  id: ClubDashboardWidgetId;
  label: string;
  icon: LucideIcon;
  color: string;
}

export const DEFAULT_CLUB_DASHBOARD_WIDGETS: ClubDashboardWidgetDefinition[] = [
  {
    id: "members",
    label: "Membres",
    icon: User,
    color: "#4CAF50",
  },
  {
    id: "registrations",
    label: "Inscriptions",
    icon: ClipboardList,
    color: "#FF9800",
  },
  {
    id: "competitions",
    label: "Compétitions",
    icon: Trophy,
    color: "#2196F3",
  },
  {
    id: "couples",
    label: "Couples",
    icon: Users,
    color: "#E91E63",
  },
  {
    id: "soloTeams",
    label: "Solo Teams",
    icon: TeamIcon as unknown as LucideIcon,
    color: "#9C27B0",
  },
];
