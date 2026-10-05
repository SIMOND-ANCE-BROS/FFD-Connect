import NetInfo from "@react-native-community/netinfo";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { QueryClient, onlineManager } from "@tanstack/react-query";
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import React from "react";
import { Alert } from "react-native";
import {
  assertReplayable,
  handleRegistrationReplayError,
  handleRegistrationReplaySuccess,
} from "../features/competitions/services/registrationQueue";
import { dispatchMutation, useOfflineQueue } from "../hooks/useOfflineQueue";
import { isNetStateOnline } from "../utils/connectivity";

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

// QueryClient partagé pour l'app mobile
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Conserver les données 24h en cache (aligné avec la persistance)
      gcTime: 1000 * 60 * 60 * 24,
      staleTime: 1000 * 30, // 30s fraîches par défaut
      refetchOnReconnect: true,
      refetchOnWindowFocus: true,
    },
  },
});

const asyncStoragePersister = createAsyncStoragePersister({
  storage: AsyncStorage,
  key: "FFD_CONNECT_QUERY_CACHE",
  throttleTime: 1000,
});

interface Props {
  children: React.ReactNode;
}

const OfflineQueueRunner = () => {
  useOfflineQueue({
    mutationFn: async (request, mutation) => {
      assertReplayable(mutation);
      await dispatchMutation(request);
    },
    onReplayError: handleRegistrationReplayError,
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
      persistOptions={{ persister: asyncStoragePersister }}
    >
      <OfflineQueueRunner />
      {children}
    </PersistQueryClientProvider>
  );
};
