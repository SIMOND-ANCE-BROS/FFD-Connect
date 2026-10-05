import { useInfiniteQuery } from "@tanstack/react-query";
import * as Location from "expo-location";
import { useCallback, useEffect, useMemo, useState } from "react";
import api from "../../../services/api";
import { createLogger } from "../../../utils/logger";
import { getEffectiveCompetitionStatus } from "../utils/competitionCard";

const logger = createLogger("useCompetitionsLogic");
import { useTheme } from "../../../context/ThemeContext";
import { useAuthRepository } from "../../auth/context/AuthContext";
import { AuthConfig } from "../../auth/services/AuthService";
import { useCompetitionRepository } from "../context/CompetitionContext";

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function pollSyncCompletion(
  jobId: string,
  intervalMs = 2000,
  timeoutMs = 60_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await api.get<{
      status: "pending" | "active" | "completed" | "failed";
      jobId?: string;
      stats?: unknown;
      error?: string;
    }>("/competitions/sync/status");
    const { status } = res.data;
    if (status === "completed" || status === "failed") return;
    await sleep(intervalMs);
  }
  // Timeout — proceed anyway, refetch will show latest data
  logger.warn("Sync polling timed out", { jobId, timeoutMs });
}

export type CompetitionScope = "ALL" | "FOR_ME";
export type CompetitionStatusFilter = "UPCOMING" | "LIVE" | "PAST" | "ALL";
/** Fenêtre de dates (toujours vers l'avant à partir d'aujourd'hui). */
export type CompetitionDatePeriod =
  | "ALL"
  | "MONTH"
  | "THREE_MONTHS"
  | "SIX_MONTHS";

/** Style de danse d'une épreuve (filtre). */
export type CompetitionStyle = "Latin" | "Standard";
/** Discipline d'une épreuve (filtre) : couple, solo, ou solo team. */
export type CompetitionDiscipline = "COUPLE" | "SOLO" | "SOLO_TEAM";

/**
 * Calcule la distance en km entre deux coordonnées GPS (formule de Haversine).
 */
export function getDistanceKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6371; // rayon de la Terre en km
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/** Nombre de mois de la fenêtre pour chaque période (null = pas de borne). */
const DATE_PERIOD_MONTHS: Record<CompetitionDatePeriod, number | null> = {
  ALL: null,
  MONTH: 1,
  THREE_MONTHS: 3,
  SIX_MONTHS: 6,
};

/**
 * Type guard pour valider CompetitionScope
 */
export function isValidCompetitionScope(
  value: string,
): value is CompetitionScope {
  return value === "ALL" || value === "FOR_ME";
}

/**
 * Type guard pour valider CompetitionStatusFilter
 */
export function isValidCompetitionStatusFilter(
  value: string,
): value is CompetitionStatusFilter {
  return ["UPCOMING", "LIVE", "PAST", "ALL"].includes(value);
}

/**
 * Convertit une string en CompetitionScope de manière sécurisée
 */
export function toCompetitionScope(value: string): CompetitionScope {
  if (isValidCompetitionScope(value)) {
    return value;
  }
  return "ALL"; // Valeur par défaut
}

/**
 * Convertit une string en CompetitionStatusFilter de manière sécurisée
 */
export function toCompetitionStatusFilter(
  value: string,
): CompetitionStatusFilter {
  if (isValidCompetitionStatusFilter(value)) {
    return value;
  }
  return "UPCOMING"; // Valeur par défaut
}

/** États liés au profil utilisateur — groupés pour éviter les re-renders en cascade. */
interface UserState {
  isGuest: boolean;
  profile: AuthConfig | null;
  role: string;
}

const DEFAULT_USER_STATE: UserState = {
  isGuest: false,
  profile: null,
  role: "LICENSEE",
};

/**
 * Hook de logique métier pour la gestion des compétitions
 *
 * Gère le filtrage des compétitions par scope (ALL/FOR_ME) et statut (UPCOMING/LIVE/PAST/ALL),
 * ainsi que le chargement et le rafraîchissement des données.
 *
 * @returns {Object} Objet contenant l'état et les actions
 * @returns {Object} state - État actuel des compétitions filtrées et de l'interface
 * @returns {Competition[]} state.competitions - Liste des compétitions filtrées
 * @returns {boolean} state.isLoading - Indique si les compétitions sont en cours de chargement
 * @returns {boolean} state.refreshing - Indique si un rafraîchissement est en cours
 * @returns {CompetitionScope} state.scope - Scope actuel du filtre (ALL ou FOR_ME)
 * @returns {CompetitionStatusFilter} state.statusFilter - Filtre de statut actuel
 * @returns {Theme} state.theme - Thème actuel de l'application
 * @returns {boolean} state.isGuest - Indique si l'utilisateur est un invité
 * @returns {string} state.role - Rôle de l'utilisateur (LICENSEE, CLUB, STAFF, ADMIN)
 * @returns {Object} actions - Actions disponibles pour modifier l'état
 * @returns {Function} actions.setScope - Modifie le scope du filtre
 * @returns {Function} actions.setStatusFilter - Modifie le filtre de statut
 * @returns {Function} actions.onRefresh - Rafraîchit la liste des compétitions
 * @returns {Function} actions.loadSettings - Recharge les paramètres utilisateur
 *
 * @example
 * ```typescript
 * const { state, actions } = useCompetitionsLogic();
 *
 * // Filtrer par scope
 * actions.setScope('FOR_ME');
 *
 * // Filtrer par statut
 * actions.setStatusFilter('LIVE');
 *
 * // Rafraîchir les données
 * await actions.onRefresh();
 * ```
 */
export const useCompetitionsLogic = () => {
  const { getCompetitions, syncCompetitions } = useCompetitionRepository();
  const { theme } = useTheme();
  const auth = useAuthRepository();

  // États de filtre — modifiés directement par l'utilisateur via des actions
  const [scope, setScope] = useState<CompetitionScope>("ALL");
  const [statusFilter, setStatusFilter] =
    useState<CompetitionStatusFilter>("UPCOMING");
  const [searchQuery, setSearchQuery] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  // Filtres avancés (distance + période) — null/ALL = pas de contrainte
  const [maxDistanceKm, setMaxDistanceKm] = useState<number | null>(null);
  const [datePeriod, setDatePeriod] = useState<CompetitionDatePeriod>("ALL");
  // Plage de dates perso (calendrier) — prioritaire sur datePeriod si définie.
  const [dateFrom, setDateFrom] = useState<Date | null>(null);
  const [dateTo, setDateTo] = useState<Date | null>(null);
  // Filtres style (Latine/Standard) et discipline (Couple/Solo/SoloTeam) —
  // multi-sélection ; vide = pas de contrainte.
  const [styleFilter, setStyleFilter] = useState<Set<CompetitionStyle>>(
    new Set(),
  );
  const [disciplineFilter, setDisciplineFilter] = useState<
    Set<CompetitionDiscipline>
  >(new Set());

  // Géolocalisation utilisateur pour calcul de distance
  const [userLocation, setUserLocation] = useState<{
    latitude: number;
    longitude: number;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const fetchLocation = async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== Location.PermissionStatus.GRANTED || cancelled) return;
        const position = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        setUserLocation({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        });
      } catch {
        // Permission refusée ou erreur — on reste à null (dégradation gracieuse)
      }
    };
    fetchLocation().catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // États liés au profil — toujours mis à jour ensemble dans loadSettings
  // Regroupés pour éviter les re-renders en cascade (au lieu de 4 setState séparés)
  const [user, setUser] = useState<UserState>(DEFAULT_USER_STATE);

  // React Query: Infinite Query for Competitions
  const {
    data: queryData,
    isLoading: isQueryLoading,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
    refetch,
  } = useInfiniteQuery({
    queryKey: ["competitions"],
    queryFn: async ({ pageParam = 0 }) => {
      return getCompetitions(pageParam, 10);
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      // getCompetitions returns { data, meta }
      if (!lastPage.meta.hasMore) return undefined;
      // offset = number of pages * take
      return allPages.length * 10;
    },
  });

  const isLoading = isQueryLoading || isFetchingNextPage;
  const hasMore = !!hasNextPage;
  const allLoadedCompetitions = useMemo(() => {
    if (!queryData) return [];
    return queryData.pages.flatMap((page) => page.data);
  }, [queryData]);

  const loadSettings = useCallback(async () => {
    const config = await auth.getAuthConfig();

    if (config.isGuest) {
      setScope("ALL");
      setUser({ isGuest: true, profile: null, role: "LICENSEE" });
    } else {
      setUser({
        isGuest: false,
        profile: config,
        role: config.role,
      });

      if (config.defaultCompetitionScope) {
        setScope(
          config.defaultCompetitionScope === "registrant" ? "FOR_ME" : "ALL",
        );
      }

      if (config.defaultCompetitionStatus) {
        setStatusFilter(config.defaultCompetitionStatus);
      }
    }
  }, [auth]);

  useEffect(() => {
    loadSettings().catch(() => {});
  }, [loadSettings]);

  const filteredCompetitions = useMemo(() => {
    // Fenêtre de dates : [aujourd'hui 00:00, aujourd'hui + N mois]. La borne
    // BASSE (aujourd'hui) est indispensable : sans elle, une période "vers
    // l'avant" laissait passer les compétitions PASSÉES (elles sont < borne
    // haute), d'où des événements passés affichés dans "À venir".
    const periodMonths = DATE_PERIOD_MONTHS[datePeriod];
    let dateUpperBound: number | null = null;
    let dateLowerBound: number | null = null;
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const startOfTodayMs = startOfToday.getTime();
    if (periodMonths !== null) {
      dateLowerBound = startOfTodayMs;
      const end = new Date();
      end.setMonth(end.getMonth() + periodMonths);
      dateUpperBound = end.getTime();
    }

    return allLoadedCompetitions.filter((comp) => {
      // 1. Filter by Scope. "FOR_ME" veut dire :
      //  - club  → les événements organisés par mon club
      //  - licencié → ceux qui correspondent à mon profil (cat./niveau/âge)
      if (scope === "FOR_ME") {
        // Un invité n'a pas de « Pour moi » (aucune éligibilité personnelle).
        if (user.isGuest) return false;
        if (user.role === "CLUB") {
          if (!comp.isOrganizedByMyClub) return false;
        } else {
          // Licencié : « Pour moi » = compétitions où je suis éligible ou déjà
          // inscrit, d'après le backend (source de vérité, même flag que le
          // badge Éligible/Inscrit de la carte). L'ancien match approximatif
          // côté client (cat./niveau/âge) traitait chaque champ vide comme un
          // joker → toutes les compétitions passaient, d'où des inéligibles.
          if (!comp.isEligible && !comp.isRegistered) return false;
        }
      }

      // 2. Filter by Status — sur le statut EFFECTIF (dérivé de la date), pas le
      // `status` stocké qui peut être périmé. Sans ça, une compétition passée
      // laissée en `UPCOMING` par le backend disparaissait de « À venir » (par la
      // correction date) ET de « Passées » (par l'égalité de statut stockée),
      // n'apparaissant que dans « Tout » — badgée « À VENIR ». Même source de
      // vérité que le badge de la carte (getEffectiveCompetitionStatus).
      if (
        statusFilter !== "ALL" &&
        getEffectiveCompetitionStatus(comp.status, comp.date, startOfToday) !==
          statusFilter
      ) {
        return false;
      }

      // 3. Filter by search query (title + location, case-insensitive)
      const query = searchQuery.trim().toLowerCase();
      if (query) {
        const title = comp.title?.toLowerCase() ?? "";
        const location = comp.location?.toLowerCase() ?? "";
        if (!title.includes(query) && !location.includes(query)) {
          return false;
        }
      }

      // 4. Filter by distance (only if a max is set, location is known and the
      //    competition has coords ; sinon on garde — dégradation gracieuse).
      if (
        maxDistanceKm !== null &&
        userLocation &&
        comp.latitude != null &&
        comp.longitude != null
      ) {
        const distance = getDistanceKm(
          userLocation.latitude,
          userLocation.longitude,
          comp.latitude,
          comp.longitude,
        );
        if (distance > maxDistanceKm) return false;
      }

      // 5. Filter by date period (fenêtre [aujourd'hui, aujourd'hui + N mois]).
      if ((dateUpperBound !== null || dateLowerBound !== null) && comp.date) {
        const compTime = new Date(comp.date).getTime();
        if (!Number.isNaN(compTime)) {
          if (dateUpperBound !== null && compTime > dateUpperBound)
            return false;
          if (dateLowerBound !== null && compTime < dateLowerBound)
            return false;
        }
      }

      // 5b. Plage de dates PERSO (calendrier) : bornes explicites [from, to].
      if ((dateFrom || dateTo) && comp.date) {
        const compTime = new Date(comp.date).getTime();
        if (!Number.isNaN(compTime)) {
          if (dateFrom) {
            const f = new Date(dateFrom);
            f.setHours(0, 0, 0, 0);
            if (compTime < f.getTime()) return false;
          }
          if (dateTo) {
            const t = new Date(dateTo);
            t.setHours(23, 59, 59, 999);
            if (compTime > t.getTime()) return false;
          }
        }
      }

      // 6. Filtre STYLE (Latine/Standard) : au moins une épreuve du style.
      //    "Ten Dance" compte comme Latine ET Standard.
      if (styleFilter.size > 0) {
        const hasStyle = comp.events?.some((e) => {
          const c = e.category;
          if (styleFilter.has("Latin") && (c === "Latin" || c === "Ten Dance"))
            return true;
          if (
            styleFilter.has("Standard") &&
            (c === "Standard" || c === "Ten Dance")
          )
            return true;
          return false;
        });
        if (!hasStyle) return false;
      }

      // 7. Filtre DISCIPLINE (Couple/Solo/SoloTeam) : au moins une épreuve.
      if (disciplineFilter.size > 0) {
        const hasDiscipline = comp.events?.some((e) => {
          if (disciplineFilter.has("SOLO_TEAM") && e.eventKind === "SOLO_TEAM")
            return true;
          if (disciplineFilter.has("SOLO") && e.eventType === "SOLO")
            return true;
          if (
            disciplineFilter.has("COUPLE") &&
            (e.eventType === "COUPLE" || !e.eventType)
          )
            return true;
          return false;
        });
        if (!hasDiscipline) return false;
      }

      return true;
    });
  }, [
    allLoadedCompetitions,
    scope,
    statusFilter,
    searchQuery,
    user,
    maxDistanceKm,
    datePeriod,
    dateFrom,
    dateTo,
    styleFilter,
    disciplineFilter,
    userLocation,
  ]);

  const handleLoadMore = async () => {
    if (hasNextPage && !isFetchingNextPage) {
      await fetchNextPage();
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      const syncResult = await syncCompetitions();
      if (syncResult?.jobId) {
        await pollSyncCompletion(syncResult.jobId);
      }
      await refetch();
    } catch {
      await refetch();
    } finally {
      setRefreshing(false);
    }
  };

  return {
    state: {
      competitions: filteredCompetitions,
      isLoading,
      refreshing,
      hasMore,
      scope,
      statusFilter,
      searchQuery,
      theme,
      // Exposés à plat pour ne pas changer l'API publique du hook
      isGuest: user.isGuest,
      role: user.role,
      userLocation,
      maxDistanceKm,
      datePeriod,
      dateFrom,
      dateTo,
      styleFilter,
      disciplineFilter,
    },
    actions: {
      setScope,
      setStatusFilter,
      setSearchQuery,
      setMaxDistanceKm,
      setDatePeriod,
      setDateFrom,
      setDateTo,
      setStyleFilter,
      setDisciplineFilter,
      onRefresh: handleRefresh,
      onLoadMore: handleLoadMore,
      loadSettings,
    },
  };
};
