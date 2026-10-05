import { create } from "zustand";

/**
 * État global du "réveil backend". Quand le Container App prod est endormi
 * (scale-to-zero), les requêtes échouent ; le wrapper de réveil
 * (utils/backendWake) déclenche le démarrage et passe `waking` à true.
 *
 * `visible` distingue un réveil bloquant (déclenché par une action utilisateur
 * → overlay de patience) d'un pré-réveil silencieux au lancement de l'app
 * (aucune UI : l'utilisateur navigue pendant que le backend démarre).
 */
interface WakeState {
  waking: boolean;
  /** L'overlay doit-il s'afficher ? false pendant un pré-réveil silencieux. */
  visible: boolean;
  /** Secondes écoulées depuis le début du réveil (pour le compte à rebours UI). */
  elapsed: number;
  setWaking: (waking: boolean) => void;
  setVisible: (visible: boolean) => void;
  setElapsed: (elapsed: number) => void;
}

export const useWakeStore = create<WakeState>((set) => ({
  waking: false,
  visible: false,
  elapsed: 0,
  // La fin d'un réveil (waking=false) masque aussi l'overlay pour que le
  // prochain réveil reparte d'un état propre.
  setWaking: (waking) =>
    set((s) => ({ waking, elapsed: 0, visible: waking ? s.visible : false })),
  setVisible: (visible) => set({ visible }),
  setElapsed: (elapsed) => set({ elapsed }),
}));
