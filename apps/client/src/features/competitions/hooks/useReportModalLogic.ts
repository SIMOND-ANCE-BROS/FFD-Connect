import * as ImagePicker from "expo-image-picker";
import { useState } from "react";
import { Alert } from "react-native";
import { ReportService } from "../services/ReportService";

const APP_VERSION = "0.0.1";

interface UseReportModalLogicProps {
  onClose: () => void;
}

export const useReportModalLogic = ({ onClose }: UseReportModalLogicProps) => {
  const [type, setType] = useState<"BUG" | "FEATURE">("BUG");
  const [module, setModule] = useState("Autre");
  const [severity, setSeverity] = useState<"LOW" | "MEDIUM" | "HIGH">("LOW");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [steps, setSteps] = useState("");
  const [image, setImage] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  const MODULES = [
    "Connexion",
    "Licences",
    "Musique",
    "Compétition",
    "Thème",
    "Autre",
  ];

  const handlePickImage = async () => {
    try {
      const { status } =
        await ImagePicker.requestMediaLibraryPermissionsAsync();
      // eslint-disable-next-line @typescript-eslint/no-unsafe-enum-comparison
      if (status !== "granted") {
        Alert.alert(
          "Permission requise",
          "Accès à la galerie photo nécessaire.",
        );
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: false,
        quality: 0.8,
        selectionLimit: 1,
      });

      if (!result.canceled && result.assets.length > 0) {
        setImage(result.assets[0]);
      }
    } catch {
      Alert.alert("Erreur", "Impossible de sélectionner une image.");
    }
  };

  const handleRemoveImage = () => {
    setImage(null);
  };

  const resetForm = () => {
    setTitle("");
    setDescription("");
    setSteps("");
    setImage(null);
    setType("BUG");
    setModule("Autre");
    setSeverity("LOW");
    setIsSubmitting(false);
    setIsSuccess(false);
  };

  const handleSubmit = async () => {
    if (!title.trim() || !description.trim()) {
      Alert.alert("Erreur", "Veuillez remplir le titre et la description.");
      return;
    }

    try {
      setIsSubmitting(true);
      await ReportService.sendReport({
        type,
        title,
        description,
        module,
        severity,
        appVersion: APP_VERSION,
        steps: type === "BUG" ? steps : undefined,
        image: image
          ? {
              uri: image.uri,
              type: image.mimeType ?? "image/jpeg",
              name: image.fileName ?? "image.jpg",
            }
          : undefined,
      });
      setIsSuccess(true);
    } catch {
      Alert.alert(
        "Erreur",
        "Impossible d'envoyer le rapport. Réessayez plus tard.",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  return {
    state: {
      type,
      module,
      severity,
      title,
      description,
      steps,
      image,
      isSubmitting,
      isSuccess,
      MODULES,
    },
    actions: {
      setType,
      setModule,
      setSeverity,
      setTitle,
      setDescription,
      setSteps,
      handlePickImage,
      handleRemoveImage,
      handleSubmit,
      handleClose,
    },
  };
};
