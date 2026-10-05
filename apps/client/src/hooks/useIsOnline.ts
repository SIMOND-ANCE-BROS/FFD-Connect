import NetInfo from "@react-native-community/netinfo";
import { useEffect, useState } from "react";
import { isNetStateOnline } from "../utils/connectivity";

/**
 * Connectivité réseau (#416). `true` par défaut (optimiste) : on ne dégrade
 * l'UX qu'une fois le hors-ligne confirmé par NetInfo.
 *
 * `isInternetReachable` peut être `null` (inconnu) pendant la sonde — on ne
 * considère hors-ligne que le `false` franc ou l'absence de connexion.
 * The policy is shared with non-React code via `utils/connectivity.ts`.
 */
export function useIsOnline(): boolean {
  const [isOnline, setIsOnline] = useState(true);

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      setIsOnline(isNetStateOnline(state));
    });
    return unsubscribe;
  }, []);

  return isOnline;
}
