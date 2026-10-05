import { useFocusEffect } from "@react-navigation/native";
import * as Sharing from "expo-sharing";
import { useCallback, useState } from "react";
import { Alert, Platform } from "react-native";
import { Gesture, PanGesture } from "react-native-gesture-handler";
import {
  Easing,
  runOnJS,
  SharedValue,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { ERROR_MESSAGES } from "../../../constants/errorMessages";
import { useErrorHandler } from "../../../hooks/useErrorHandler";
import { useLoadingState } from "../../../hooks/useLoadingState";
import { createLogger } from "../../../utils/logger";
import { PDFAdapter, ShareAdapter } from "../../../utils/platform-adapters";
import { useAuthRepository, UserRole } from "../../auth/context/AuthContext";
import { LicenseUser } from "../components/LicenseCard";
import {
  loadLicenseSnapshot,
  saveLicenseSnapshot,
} from "../utils/licenseSnapshot";

const logger = createLogger("useLicenseLogic");

interface LicenseLogicState {
  loadingPdf: boolean;
  showQr: boolean;
  activeQrData:
    | {
        id?: string;
        type?: string;
        [key: string]: string | number | boolean | undefined;
      }
    | string
    | null;
  photoUri: string | null;
  activeCardIndex: number;
  showWdsf: boolean;
  wdsfModalVisible: boolean;
  verifyingWdsf: boolean;
  wdsfError: string | null;
  role: UserRole;
  listItems: Array<{ type: string; data: LicenseUser | null }>;
  /** Non-null = licence servie depuis le snapshot local (ISO de la dernière synchro). */
  offlineSince: string | null;
  pullY: SharedValue<number>;
  pullGesture: PanGesture;
}

/**
 * Hook de logique métier pour la gestion des licences
 *
 * Gère l'affichage des cartes de licence, la génération et le partage de PDF,
 * la vérification WDSF, et l'affichage des QR codes.
 *
 * @returns {Object} Objet contenant l'état et les actions
 * @returns {LicenseLogicState} state - État actuel de la logique de licence
 * @returns {boolean} state.loadingPdf - Indique si un PDF est en cours de génération
 * @returns {boolean} state.showQr - Indique si le QR code est affiché
 * @returns {Object|string|null} state.activeQrData - Données du QR code actif
 * @returns {string|null} state.photoUri - URI de la photo de licence
 * @returns {number} state.activeCardIndex - Index de la carte active
 * @returns {boolean} state.showWdsf - Indique si WDSF est affiché
 * @returns {boolean} state.wdsfModalVisible - Indique si le modal WDSF est visible
 * @returns {boolean} state.verifyingWdsf - Indique si une vérification WDSF est en cours
 * @returns {string|null} state.wdsfError - Message d'erreur WDSF éventuel
 * @returns {UserRole} state.role - Rôle de l'utilisateur
 * @returns {Array} state.listItems - Liste des éléments de licence
 * @returns {SharedValue<number>} state.pullY - Valeur partagée pour l'animation de pull
 * @returns {PanGesture} state.pullGesture - Geste de pan pour l'interaction
 * @returns {Object} actions - Actions disponibles
 * @returns {Function} actions.setWdsfModalVisible - Affiche/masque le modal WDSF
 * @returns {Function} actions.setShowQr - Affiche/masque le QR code
 * @returns {Function} actions.handleCardPress - Gère le clic sur une carte
 * @returns {Function} actions.handleShowQr - Affiche un QR code avec des données spécifiques
 * @returns {Function} actions.generateAndSharePdf - Génère et partage un PDF de licence
 * @returns {Function} actions.handleVerifyWdsf - Vérifie une licence WDSF
 * @returns {Function} actions.handleRemoveWdsfWithConfirm - Supprime WDSF avec confirmation
 * @returns {Function} actions.handleAddWdsf - Ajoute une licence WDSF
 *
 * @example
 * ```typescript
 * const { state, actions } = useLicenseLogic();
 *
 * // Afficher un QR code
 * actions.handleShowQr('license-data');
 *
 * // Générer et partager un PDF
 * await actions.generateAndSharePdf();
 *
 * // Vérifier une licence WDSF
 * await actions.handleVerifyWdsf('MIN123456');
 * ```
 */
export const useLicenseLogic = (): {
  state: LicenseLogicState;
  actions: {
    setWdsfModalVisible: (visible: boolean) => void;
    setShowQr: (visible: boolean) => void;
    handleCardPress: (index: number) => void;
    handleShowQr: (data: string) => void;
    generateAndSharePdf: () => Promise<void>;
    handleVerifyWdsf: (min: string) => Promise<void>;
    handleRemoveWdsfWithConfirm: (resetCallback?: () => void) => void;
    handleAddWdsf: () => void;
  };
} => {
  const auth = useAuthRepository();
  const { isLoading: loadingPdf, withLoading: withLoadingPdf } =
    useLoadingState();
  const {
    isLoading: verifyingWdsf,
    startLoading: startVerifyingWdsf,
    stopLoading: stopVerifyingWdsf,
  } = useLoadingState();
  const { withErrorHandling } = useErrorHandler();

  // State
  const [showQr, setShowQr] = useState(false);
  const [activeQrData, setActiveQrData] = useState<string | object | null>(
    null,
  );
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [activeCardIndex, setActiveCardIndex] = useState(0);
  const [showWdsf, setShowWdsf] = useState(false);
  const [wdsfModalVisible, setWdsfModalVisible] = useState(false);
  const [wdsfError, setWdsfError] = useState<string | null>(null);
  const [role, setRole] = useState<UserRole>("LICENSEE");
  const [ffdUser, setFfdUser] = useState<LicenseUser | null>(null);
  const [wdsfUser, setWdsfUser] = useState<LicenseUser | null>(null);
  // Non-null = licence affichée depuis le snapshot local (pas de réseau) ;
  // contient la date ISO de la dernière synchro réussie (#416).
  const [offlineSince, setOfflineSince] = useState<string | null>(null);

  // Shared Value for Animation
  const pullY = useSharedValue(0);

  // Load Config & Profile
  useFocusEffect(
    useCallback(() => {
      const loadData = async () => {
        try {
          // 1. Load Local Config
          const config = await auth.getAuthConfig();
          setPhotoUri(config.licensePhotoUri ?? null);
          setShowWdsf(config.hasWdsfLicense ?? false);
          setRole(config.role);

          // 2. Fetch Real Profile if logged in
          if (config.isLoggedIn && config.role !== "GUEST") {
            const profile = await auth.getProfile();

            // Map Backend User to LicenseUser interface
            const mappedFfdUser: LicenseUser = {
              firstName: profile.firstName,
              lastName: profile.lastName,
              licenseNumber: profile.license?.number ?? "Non renseigné",
              type: profile.role === "ADMIN" ? "Administrateur" : "Athlète",
              structure: profile.clubName ?? "FFD",
              validUntil: profile.license?.validUntil
                ? new Date(profile.license.validUntil).toLocaleDateString(
                    "fr-FR",
                  )
                : "31/08/2026",
              validUntilRaw: profile.license?.validUntil ?? undefined,
              season: "2025/2026",
              birthDate: profile.birthDate
                ? new Date(profile.birthDate).toLocaleDateString("fr-FR")
                : "--/--/----",
            };
            setFfdUser(mappedFfdUser);
            let nextWdsfUser: LicenseUser | null = null;

            if (config.hasWdsfLicense) {
              if (profile.wdsf?.min) {
                const formatDate = (iso: string | null | undefined): string => {
                  if (!iso) return "Active";
                  const d = new Date(iso);
                  return Number.isNaN(d.getTime())
                    ? iso
                    : d.toLocaleDateString("fr-FR", {
                        day: "numeric",
                        month: "long",
                        year: "numeric",
                      });
                };
                nextWdsfUser = {
                  firstName: profile.firstName,
                  lastName: profile.lastName,
                  licenseNumber: profile.wdsf.min,
                  type: profile.wdsf.licenseType ?? "Athlete's License",
                  structure: "WDSF",
                  validUntil: formatDate(profile.wdsf.expiresOn),
                  season: new Date().getFullYear().toString(),
                  birthDate: mappedFfdUser.birthDate,
                  country: profile.wdsf.nationality ?? undefined,
                  ageGroup: profile.wdsf.ageGroup ?? undefined,
                };
              } else {
                nextWdsfUser = {
                  firstName: profile.firstName,
                  lastName: profile.lastName,
                  licenseNumber: "WDSF-PENDING",
                  type: "Athlete",
                  structure: "WDSF",
                  validUntil: "Active",
                  season: "2025",
                  birthDate: mappedFfdUser.birthDate,
                };
              }
              setWdsfUser(nextWdsfUser);
            }

            // Synchro réussie : rafraîchit le snapshot hors-ligne (#416) et
            // sort du mode dégradé le cas échéant.
            setOfflineSince(null);
            void saveLicenseSnapshot(mappedFfdUser, nextWdsfUser);
          }
        } catch (err) {
          logger.error("Failed to load data", err);
          // Pas de réseau (gymnase, mode avion) : la licence et son QR
          // restent consultables depuis le dernier snapshot local (#416).
          const snapshot = await loadLicenseSnapshot();
          if (snapshot) {
            setFfdUser(snapshot.ffdUser);
            if (snapshot.wdsfUser) setWdsfUser(snapshot.wdsfUser);
            setOfflineSince(snapshot.savedAt);
          }
        }
      };
      loadData().catch(() => {});
    }, [auth]),
  );

  // Actions
  const handleCardPress = (index: number) => {
    setActiveCardIndex(index);
  };

  const handleShowQr = (data: string) => {
    try {
      const parsed: object = JSON.parse(data) as object;
      setActiveQrData(parsed);
    } catch {
      setActiveQrData(data);
    }
    setShowQr(true);
  };

  const generateAndSharePdf = useCallback(async () => {
    await withErrorHandling(
      async () => {
        await withLoadingPdf(async () => {
          const options = {
            html: `
                  <h1>Licence FFD</h1>
                  <p>Nom: ${ffdUser?.lastName ?? ""}</p>
                  <p>Prénom: ${ffdUser?.firstName ?? ""}</p>
                  <p>Licence: ${ffdUser?.licenseNumber ?? ""}</p>
                  <p>Structure: ${ffdUser?.structure ?? ""}</p>
                `,
            fileName: "Licence_FFD_2026",
            directory: "Documents",
          };

          const file = await PDFAdapter.generatePDF(options);

          // Use expo-sharing for native platforms, ShareAdapter for web compatibility
          if (Platform.OS === "web") {
            await ShareAdapter.open({
              title: "Partager ma licence",
              url: file.filePath,
            });
          } else {
            // Check if sharing is available
            const isAvailable = await Sharing.isAvailableAsync();
            if (isAvailable) {
              await Sharing.shareAsync(
                Platform.OS === "android"
                  ? `file://${file.filePath}`
                  : file.filePath,
                {
                  mimeType: "application/pdf",
                  dialogTitle: "Partager ma licence",
                },
              );
            } else {
              // Fallback to ShareAdapter
              await ShareAdapter.open({
                title: "Partager ma licence",
                url:
                  Platform.OS === "android"
                    ? `file://${file.filePath}`
                    : file.filePath,
              });
            }
          }
        });
      },
      {
        userMessage: ERROR_MESSAGES.PDF_GENERATION_FAILED,
        showAlert: true,
        logError: true,
      },
    );
  }, [ffdUser, withErrorHandling, withLoadingPdf]);

  const handleVerifyWdsf = async (min: string) => {
    setWdsfError(null);
    const config = await auth.getAuthConfig();
    if (!config.authToken || !config.isLoggedIn) {
      setWdsfError("Connectez-vous pour ajouter une licence WDSF.");
      return;
    }
    await withErrorHandling(
      async () => {
        startVerifyingWdsf();
        try {
          const wdsfData = await auth.verifyWdsfLicense(min);

          // Map WDSF API response to LicenseUser
          const formatDate = (isoOrLabel: string): string => {
            if (isoOrLabel === "Active") return isoOrLabel;
            const d = new Date(isoOrLabel);
            if (Number.isNaN(d.getTime())) return isoOrLabel;
            return d.toLocaleDateString("fr-FR", {
              day: "numeric",
              month: "long",
              year: "numeric",
            });
          };
          const mappedWdsfUser: LicenseUser = {
            firstName: wdsfData.firstName,
            lastName: wdsfData.lastName,
            licenseNumber: wdsfData.licenseNumber,
            type: wdsfData.type,
            structure: wdsfData.structure,
            validUntil: formatDate(wdsfData.validUntil),
            season: new Date().getFullYear().toString(),
            birthDate: wdsfData.birthDate
              ? (() => {
                  const d = new Date(wdsfData.birthDate);
                  return Number.isNaN(d.getTime())
                    ? wdsfData.birthDate
                    : d.toLocaleDateString("fr-FR", {
                        day: "numeric",
                        month: "long",
                        year: "numeric",
                      });
                })()
              : "--/--/----",
            country: wdsfData.country,
            status: wdsfData.status,
            ageGroup: wdsfData.ageGroup,
            partnerName: wdsfData.partnerName,
            partnerAgeGroup: wdsfData.partnerAgeGroup,
            photoUrl: wdsfData.photoUrl,
          };

          setWdsfUser(mappedWdsfUser);
          setWdsfModalVisible(false);
          await auth.setWdsfLicenseEnabled(true);
          setShowWdsf(true);
          setActiveCardIndex(1); // Focus new card
          await auth.saveWdsfToBackend({
            min: wdsfData.licenseNumber,
            nationality: wdsfData.country ?? null,
            licenseType: wdsfData.type,
            ageGroup: wdsfData.ageGroup ?? null,
            expiresOn:
              wdsfData.validUntil && wdsfData.validUntil !== "Active"
                ? wdsfData.validUntil
                : null,
          });
        } finally {
          stopVerifyingWdsf();
        }
      },
      {
        userMessage: ERROR_MESSAGES.WDSF_VERIFICATION_FAILED,
        showAlert: false, // On utilise setWdsfError pour l'affichage dans le modal
        logError: true,
        onError: (error) => {
          setWdsfError(error.message);
        },
      },
    );
  };

  const handleRemoveWdsf = useCallback(async () => {
    await auth.setWdsfLicenseEnabled(false);
    await auth.saveWdsfToBackend(null);
    setWdsfUser(null);
    setShowWdsf(false);
    setActiveCardIndex(0);
  }, [auth]);

  const handleRemoveWdsfWithConfirm = useCallback(
    (resetCallback?: () => void) => {
      Alert.alert(
        "Supprimer la licence WDSF ?",
        "Vous pourrez la rajouter plus tard facilement.",
        [
          {
            text: "Annuler",
            style: "cancel",
            onPress: () => {
              if (resetCallback) resetCallback();
            },
          },
          {
            text: "Supprimer",
            style: "destructive",
            onPress: () => {
              handleRemoveWdsf().catch(() => {});
            },
          },
        ],
      );
    },
    [handleRemoveWdsf],
  );

  const handleAddWdsf = useCallback(() => {
    setWdsfModalVisible(true);
  }, []);

  const handleTriggerAdd = useCallback(() => {
    handleAddWdsf();
  }, [handleAddWdsf]);

  // Gesture Logic
  const pullGesture = Gesture.Pan()
    .enabled(activeCardIndex === 0 && !showWdsf && role !== "GUEST")
    .activeOffsetY(5)
    .failOffsetX([-10, 10])
    .onUpdate((event) => {
      if (event.translationY > 0) {
        pullY.value = event.translationY * 0.4;
      }
    })
    .onEnd((event) => {
      if (event.translationY > 120) {
        pullY.value = withTiming(0, undefined, (finished) => {
          if (finished) runOnJS(handleTriggerAdd)();
        });
      } else {
        pullY.value = withTiming(0, {
          duration: 350,
          easing: Easing.inOut(Easing.quad),
        });
      }
    });

  // List Logic
  const getListItems = () => {
    if (role === "GUEST") {
      return [{ type: "GUEST", data: null }];
    }
    if (role === "STAFF") {
      return [
        {
          type: "STAFF",
          data: {
            firstName: "Staff",
            lastName: "OFFICIEL",
            licenseNumber: "STAFF-001",
            type: "STAFF / ORGANISATEUR",
            structure: "Fédération Française de Danse",
            validUntil: "PERMANENT",
            season: "2025/2026",
            birthDate: "",
          } as LicenseUser,
        },
      ];
    }
    if (role === "CLUB") {
      return [
        {
          type: "STAFF",
          data: {
            firstName: "Club",
            lastName: "EXAMPLE",
            licenseNumber: "CLUB-001",
            type: "CLUB / ASSOCIATION",
            structure: "Fédération Française de Danse",
            validUntil: "2025/2026",
            season: "2025/2026",
            birthDate: "",
          } as LicenseUser,
        },
      ];
    }

    // LICENSEE
    const items = [];
    if (ffdUser) {
      items.push({ type: "FFD", data: ffdUser });
    }

    if (showWdsf && wdsfUser) {
      items.push({ type: "WDSF", data: wdsfUser });
    } else if (!showWdsf) {
      items.push({ type: "ADD_WDSF", data: null });
    }

    return items;
  };

  return {
    state: {
      loadingPdf,
      showQr,
      activeQrData: activeQrData as
        | {
            [key: string]: string | number | boolean | undefined;
            id?: string;
            type?: string;
          }
        | string
        | null,
      photoUri,
      activeCardIndex,
      showWdsf,
      wdsfModalVisible,
      verifyingWdsf,
      wdsfError,
      role,
      listItems: getListItems(),
      pullY,
      pullGesture,
      offlineSince,
    },
    actions: {
      setWdsfModalVisible,
      setShowQr,
      handleCardPress,
      handleShowQr,
      generateAndSharePdf,
      handleVerifyWdsf,
      handleRemoveWdsfWithConfirm,
      handleAddWdsf,
    },
  };
};
