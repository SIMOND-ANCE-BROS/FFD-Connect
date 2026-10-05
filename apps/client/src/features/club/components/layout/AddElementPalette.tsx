import { LayoutGrid, Sofa, Square } from "lucide-react-native";
import React from "react";
import { TouchableOpacity, View } from "react-native";
import { AppText } from "../../../../components/AppText";
import { AppTheme } from "../../../../context/ThemeContext";
import { styles } from "./layout-canvas.styles";

type LayoutType = "TABLE" | "GRADIN" | "OTHER";

function makePaletteItems(primary: string) {
  return [
    {
      type: "GRADIN" as const,
      label: "Gradin",
      icon: <LayoutGrid size={18} color={primary} />,
    },
    {
      type: "TABLE" as const,
      label: "Table",
      icon: <Sofa size={18} color={primary} />,
    },
    {
      type: "OTHER" as const,
      label: "Autre",
      icon: <Square size={18} color={primary} />,
    },
  ];
}

interface AddElementPaletteProps {
  theme: AppTheme;
  onAddElement: (type: LayoutType) => void;
}

export function AddElementPalette({
  theme,
  onAddElement,
}: AddElementPaletteProps) {
  const primaryColorStyle = { color: theme.primary };
  const paletteChipLabelStyle = [styles.paletteChipLabel, primaryColorStyle];

  return (
    <View style={styles.palette}>
      <AppText
        variant="caption"
        style={[styles.paletteLabel, { color: theme.textSecondary }]}
      >
        Ajouter :
      </AppText>
      {makePaletteItems(theme.primary).map(({ type, label, icon }) => (
        <TouchableOpacity
          key={type}
          accessibilityRole="button"
          accessibilityLabel={`Ajouter un ${label}`}
          accessibilityHint={`Ajoute un élément de type ${label} au plan`}
          style={[
            styles.paletteChip,
            {
              borderColor: theme.primary,
              backgroundColor: `${theme.primary}12`,
            },
          ]}
          onPress={() => onAddElement(type)}
        >
          {icon}
          <AppText variant="caption" style={paletteChipLabelStyle}>
            {label}
          </AppText>
        </TouchableOpacity>
      ))}
    </View>
  );
}
