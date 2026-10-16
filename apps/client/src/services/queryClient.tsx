import NetInfo from "@react-native-community/netinfo";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  QueryClient,
  defaultShouldDehydrateQuery,
  focusManager,
  onlineManager,
  type Query,
} from "@tanstack/react-query";
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import React from "react";
import { Alert, AppState, type AppStateStatus } from "react-native";
import {
  assertReplayable,
  handleRegistrationReplayError,
  handleRegistrationReplaySuccess,
} from "../features/competitions/services/registrationQueue";
import {
  CHECKIN_KIND,
  handleCheckinReplayError,
  replayCheckin,
} from "../features/license/services/offlineCheckin";
import { dispatchMutation, useOfflineQueue } from "../hooks/useOfflineQueue";
import { isNetStateOnline } from "../utils/connectivity";
import { onSessionEnd } from "./sessionCleanup";

/**
 * React Query ne sait PAS qu'on est hors ligne tant qu'on ne le lui dit pas :
 * par défaut `onlineManager` se croit toujours en ligne sur React Native.
 * Conséquence observée (#416) : une action mise en file hors ligne invalidait
 * quand même ses clés, React Query refetchait, la requête échouait sans
 * réponse HTTP, et `api.ts` déclenchait un réveil backend — overlay plein
 * écran et polling `/health` jusqu'à 150 s, alors que l'utilisateur venait
 * justement d'être prévenu que son action attendait le réseau.
 *
 * Brancher le manager sur NetInfo met les requêtes en pause hors ligne au lieu
 * de les condamner, et rend enfin effectif le `refetchOnReconnect` ci-dessous.
 * Même politique optimiste que `useIsOnline` : hors ligne seulement sur un
 * `false` franc.
 */
onlineManager.setEventListener((setOnline) =>
  NetInfo.addEventListener((state) => {
    setOnline(isNetStateOnline(state));
  }),
);

/**
 * Same story for focus (#300): on React Native `focusManager` listens to the
 * DOM `visibilitychange` event, which never fires, so `refetchOnWindowFocus`
 * was dead. Wire it to AppState: back to the foreground = focus.
 *
 * - Only `background` -> `active` counts. iOS goes `inactive` for the Face ID
 *   prompt, Control Center, the notification shade or the app switcher peek;
 *   those keep the previous focus so they never trigger a refetch.
 * - React Query only refetches queries that have a mounted observer AND are
 *   stale (`staleTime`, 30 s by default), once per transition (`setFocused`
 *   is a no-op when the value does not change) — no burst, no global reload.
 * - Unfocused while in background: no focus-driven work there (#539).
 * - A sleeping backend is woken by the existing wake-and-replay of `api.ts`
 *   (WakeOverlay), exactly like a screen mount — no ad hoc wake logic here.
 */
export function focusFromAppState(
  status: AppStateStatus | null | undefined,
): boolean | undefined {
  if (status === "active") return true;
  if (status === "background") return false;
  return undefined;
}

focusManager.setEventListener((setFocused) => {
  // A data-only push can launch the JS in the background (#775): start
  // unfocused so the first real foreground counts as a focus.
  if (AppState.currentState === "background") setFocused(false);
  const subscription = AppState.addEventListener("change", (status) => {
    const focused = focusFromAppState(status);
    if (focused !== undefined) setFocused(focused);
  });
  return () => subscription.remove();
});

// QueryClient partagé pour l'app mobile
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Conserver les données 24h en cache (aligné avec la persistance)
      gcTime: 1000 * 60 * 60 * 24,
      staleTime: 1000 * 30, // 30s fraîches par défaut
      refetchOnReconnect: true,
      // Effective through the AppState-wired focusManager above (#300).
      // Stale queries only: a screen needing fresher data on focus sets a
      // shorter staleTime; one that must never refetch sets this to false.
      refetchOnWindowFocus: true,
    },
  },
});

/** Clé AsyncStorage du cache React Query persisté. */
export const QUERY_CACHE_KEY = "FFD_CONNECT_QUERY_CACHE";

const asyncStoragePersister = createAsyncStoragePersister({
  storage: AsyncStorage,
  key: QUERY_CACHE_KEY,
  throttleTime: 1000,
});

/**
 * Familles de requêtes jamais écrites sur le disque. Les propositions de
 * correction exposent des données d'autres utilisateurs (noms des auteurs,
 * commentaires) côté admin : inutile de les laisser 24 h dans AsyncStorage.
 */
const NON_PERSISTED_QUERY_ROOTS: readonly string[] = [
  "track-corrections",
  // Renewal state (#268): tied to a medical certificate, kept in memory only.
  "license-renewal",
  // Parental consent (#61): carries a parent's (masked) address.
  "parental-consent",
];

/** Filtre de persistance : le défaut de React Query, moins les exclusions. */
export function shouldPersistQuery(query: Query): boolean {
  const root = query.queryKey[0];
  if (typeof root === "string" && NON_PERSISTED_QUERY_ROOTS.includes(root)) {
    return false;
  }
  return defaultShouldDehydrateQuery(query);
}

/**
 * Purge à la déconnexion : cache mémoire ET copie persistée, pour que le
 * compte suivant (ou une personne qui récupère l'appareil) ne retrouve rien
 * de la session précédente.
 */
export async function clearQueryCache(): Promise<void> {
  queryClient.clear();
  await AsyncStorage.removeItem(QUERY_CACHE_KEY);
}

onSessionEnd(clearQueryCache);

interface Props {
  children: React.ReactNode;
}

const OfflineQueueRunner = () => {
  useOfflineQueue({
    mutationFn: async (request, mutation) => {
      if (mutation.kind === CHECKIN_KIND) {
        await replayCheckin(request, mutation);
        return;
      }
      assertReplayable(mutation);
      await dispatchMutation(request);
    },
    onReplayError: (mutation, error) =>
      handleCheckinReplayError(mutation, error) ??
      handleRegistrationReplayError(mutation, error),
    onReplaySuccess: handleRegistrationReplaySuccess,
    onConflict: () =>
      Alert.alert(
        "Données mises à jour",
        "Tes modifications ont été ignorées car les données ont été mises à jour depuis une autre session.",
      ),
  });
  return null;
};

/**
 * Wrapper pour fournir un QueryClient persistant (offline-lite) à l'application.
 */
export const PersistedQueryClientProvider = ({ children }: Props) => {
  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister: asyncStoragePersister,
        dehydrateOptions: { shouldDehydrateQuery: shouldPersistQuery },
      }}
    >
      <OfflineQueueRunner />
      {children}
    </PersistQueryClientProvider>
  );
};
