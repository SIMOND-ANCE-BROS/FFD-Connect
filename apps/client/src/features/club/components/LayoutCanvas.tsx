import React, { useCallback, useState } from "react";
import { Dimensions, LayoutChangeEvent, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
} from "react-native-reanimated";
import { AppText } from "../../../components/AppText";
import { AppTheme } from "../../../context/ThemeContext";
import type { LayoutItem } from "../hooks/useClubCompetitionEditorLogic";
import { AddElementPalette } from "./layout/AddElementPalette";
import { DraggableLayoutItem } from "./layout/DraggableLayoutItem";
import { ItemPopupModal } from "./layout/ItemPopupModal";
import {
  PISTE_HEIGHT_PCT,
  PISTE_LEFT_PCT,
  PISTE_TOP_PCT,
  PISTE_WIDTH_PCT,
  styles,
} from "./layout/layout-canvas.styles";

type LayoutType = "TABLE" | "GRADIN" | "OTHER";

interface LayoutCanvasProps {
  layoutItems: LayoutItem[];
  theme: AppTheme;
  onAddElement: (type: LayoutType) => void;
  onEditElement: (item: LayoutItem) => void;
  /** Called when user triggers a quick edit (double tap) directly depuis le canvas. */
  onQuickEditElement?: (item: LayoutItem) => void;
  onPositionChange: (id: string, x: number, y: number) => void;
  onToggleSeatLock: (id: string, seatIndex: number) => void;
  onCycleOrientation: (id: string) => void;
}

export function LayoutCanvas({
  layoutItems,
  theme,
  onAddElement,
  onEditElement,
  onQuickEditElement,
  onPositionChange,
  onToggleSeatLock,
  onCycleOrientation,
}: LayoutCanvasProps) {
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  const [popupItem, setPopupItem] = useState<LayoutItem | null>(null);

  const baseScale = useSharedValue(1);
  const pinchScale = useSharedValue(1);
  // Clamp scale to avoid CGAffineTransformInvert: singular matrix (scale 0 is invalid)
  const scale = useDerivedValue(() =>
    Math.max(0.01, Math.min(10, baseScale.value * pinchScale.value)),
  );
  const baseTranslateX = useSharedValue(0);
  const baseTranslateY = useSharedValue(0);
  const panTranslateX = useSharedValue(0);
  const panTranslateY = useSharedValue(0);
  const [jsScale, setJsScale] = useState(1);

  const onCanvasLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setCanvasSize({ width, height });
  }, []);

  const currentPopupItem = popupItem
    ? (layoutItems.find((i) => i.id === popupItem.id) ?? popupItem)
    : null;

  const pinchGesture = Gesture.Pinch()
    .onUpdate((e) => {
      pinchScale.value = e.scale;
    })
    .onEnd(() => {
      const nextScale = Math.min(
        2.5,
        Math.max(1, baseScale.value * pinchScale.value),
      );
      baseScale.value = nextScale;
      pinchScale.value = 1;
      runOnJS(setJsScale)(nextScale);
    });

  const panGesture = Gesture.Pan()
    .onUpdate((e) => {
      panTranslateX.value = e.translationX;
      panTranslateY.value = e.translationY;
    })
    .onEnd((e) => {
      baseTranslateX.value += e.translationX;
      baseTranslateY.value += e.translationY;
      panTranslateX.value = 0;
      panTranslateY.value = 0;
    });

  const combinedCanvasGesture = Gesture.Simultaneous(pinchGesture, panGesture);

  const canvasAnimatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: baseTranslateX.value + panTranslateX.value },
      { translateY: baseTranslateY.value + panTranslateY.value },
      { scale: scale.value },
    ],
  }));

  const windowHeight = Dimensions.get("window").height;
  const canvasHeight = Math.min(380, windowHeight * 0.45);

  return (
    <View style={styles.wrapper}>
      <AddElementPalette theme={theme} onAddElement={onAddElement} />

      <View
        style={[
          styles.canvas,
          {
            backgroundColor: theme.background,
            borderColor: theme.border,
            height: canvasHeight,
          },
        ]}
        onLayout={onCanvasLayout}
      >
        <GestureDetector gesture={combinedCanvasGesture}>
          <Animated.View style={[styles.canvasInner, canvasAnimatedStyle]}>
            {/* Piste centrale fixe */}
            <View
              style={[
                styles.piste,
                {
                  left: `${PISTE_LEFT_PCT}%`,
                  top: `${PISTE_TOP_PCT}%`,
                  width: `${PISTE_WIDTH_PCT}%`,
                  height: `${PISTE_HEIGHT_PCT}%`,
                  backgroundColor: `${theme.primary}18`,
                  borderColor: theme.primary,
                },
              ]}
            >
              <AppText
                variant="caption"
                style={[styles.pisteLabel, { color: theme.textSecondary }]}
              >
                Piste
              </AppText>
            </View>

            {layoutItems.map((item) => (
              <DraggableLayoutItem
                key={item.id}
                item={item}
                canvasWidth={canvasSize.width}
                canvasHeight={canvasSize.height}
                theme={theme}
                isSelected={currentPopupItem?.id === item.id}
                zoomScale={jsScale}
                onPositionChange={onPositionChange}
                onBlockPress={setPopupItem}
                onQuickEdit={onQuickEditElement ?? onEditElement}
              />
            ))}
          </Animated.View>
        </GestureDetector>
      </View>

      <ItemPopupModal
        item={currentPopupItem}
        theme={theme}
        onClose={() => setPopupItem(null)}
        onEditElement={onEditElement}
        onQuickEditElement={onQuickEditElement}
        onToggleSeatLock={onToggleSeatLock}
        onCycleOrientation={onCycleOrientation}
      />
    </View>
  );
}
