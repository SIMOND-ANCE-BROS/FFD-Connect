import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { CameraView, useCameraPermissions } from "expo-camera";
import { RefreshCw, X } from "lucide-react-native";
import React from "react";
import {
  ActivityIndicator,
  StyleSheet,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { AppButton } from "../../../components/AppButton";
import { AppText } from "../../../components/AppText";
import { useTheme } from "../../../context/ThemeContext";
import { RootStackParamList } from "../../../navigation/types";
import { useVolunteerCheckinLogic } from "../hooks/useVolunteerCheckinLogic";

type Props = NativeStackScreenProps<RootStackParamList, "VolunteerCheckin">;

export const VolunteerCheckinScreen = ({ route, navigation }: Props) => {
  const { competitionId, token } = route.params;
  const { theme: currentTheme } = useTheme();
  const [permission, requestPermission] = useCameraPermissions();
  const { state, actions } = useVolunteerCheckinLogic(competitionId, token);

  if (!permission) {
    return <View />;
  }

  if (!permission.granted) {
    return (
      <View
        style={[
          styles.container,
          styles.permissionContainer,
          { backgroundColor: currentTheme.background },
        ]}
      >
        <AppText variant="h2" style={styles.centerText}>
          Accès Caméra Requis
        </AppText>
        <AppText
          variant="body"
          style={[styles.centerText, styles.marginBottom20]}
        >
          Pour scanner les QR codes des participants, nous avons besoin
          d'accéder à votre caméra.
        </AppText>
        <AppButton
          title="Autoriser la caméra"
          onPress={() => {
            requestPermission().catch(() => {});
          }}
        />
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.flexOne}>
      <View style={[styles.container, styles.blackBackground]}>
        <View style={styles.header}>
          <AppText variant="h2" color="white">
            Scanner Participant
          </AppText>
          <AppText variant="caption" color="#AAA">
            Bénévole FFD Connect
          </AppText>
        </View>

        {state.isScanning ? (
          <CameraView
            style={styles.camera}
            onBarcodeScanned={(result) => {
              actions.handleBarCodeScanned(result.data).catch(() => {});
            }}
            barcodeScannerSettings={{
              barcodeTypes: ["qr"],
            }}
          />
        ) : (
          <View style={styles.resultView}>
            {state.isValidating ? (
              <ActivityIndicator size="large" color={currentTheme.primary} />
            ) : (
              <View style={styles.resultContent}>
                <AppButton
                  title="Scanner à nouveau"
                  onPress={actions.reset}
                  variant="primary"
                  icon={<RefreshCw size={20} color="white" />}
                />
              </View>
            )}
          </View>
        )}

        <View style={styles.footer}>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Fermer"
            accessibilityHint="Ferme le scanner et retourne à l'écran précédent"
            style={styles.closeButton}
            onPress={() => navigation.goBack()}
          >
            <X color="white" size={32} />
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  flexOne: {
    flex: 1,
  },
  container: {
    flex: 1,
  },
  camera: {
    flex: 1,
    marginVertical: 40,
  },
  header: {
    padding: 20,
    alignItems: "center",
  },
  footer: {
    padding: 20,
    alignItems: "center",
    paddingBottom: 40,
  },
  centerText: {
    textAlign: "center",
  },
  resultView: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  resultContent: {
    width: "80%",
    alignItems: "center",
  },
  closeButton: {
    padding: 10,
    borderRadius: 30,
    backgroundColor: "rgba(255,255,255,0.2)",
  },
  permissionContainer: {
    justifyContent: "center",
    padding: 20,
  },
  marginBottom20: {
    marginBottom: 20,
  },
  blackBackground: {
    backgroundColor: "black",
  },
});
