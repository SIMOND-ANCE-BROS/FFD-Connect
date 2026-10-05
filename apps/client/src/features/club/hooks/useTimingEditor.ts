import { useState } from "react";
import { Alert } from "react-native";
import type { ScheduleItem } from "./useClubCompetitionEditorLogic.types";

interface UseTimingEditorParams {
  initialSchedule?: ScheduleItem[];
}

export const useTimingEditor = ({ initialSchedule }: UseTimingEditorParams) => {
  // --- TIMING STATE ---
  const [schedule, setSchedule] = useState<ScheduleItem[]>(
    initialSchedule ?? [
      {
        id: "1",
        startTime: "10:00",
        type: "ROUND",
        title: "Latine - Adulte - 1/4 Finale",
        duration: 15,
      },
      {
        id: "2",
        startTime: "10:15",
        type: "BREAK",
        title: "Pause",
        duration: 15,
      },
      {
        id: "3",
        startTime: "10:30",
        type: "ROUND",
        title: "Standard - Senior - Finale",
        duration: 10,
      },
    ],
  );
  const [showTimingModal, setShowTimingModal] = useState(false);

  // Timing Form State
  const [editingTimingId, setEditingTimingId] = useState<string | null>(null);
  const [newTime, setNewTime] = useState(new Date());
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [newTimeText, setNewTimeText] = useState("10:00");
  const [newTimingType, setNewTimingType] = useState<
    "ROUND" | "BREAK" | "CEREMONY" | "OTHER"
  >("ROUND");
  const [newTimingTitle, setNewTimingTitle] = useState("");
  const [newTimingDuration, setNewTimingDuration] = useState("15");

  // --- HELPERS ---
  const addMinutes = (time: string, minutes: number): string => {
    const [h, m] = time.split(":").map(Number);
    const d = new Date();
    d.setHours(h);
    d.setMinutes(m + minutes);
    return d.toLocaleTimeString("fr-FR", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  };

  const recalculateSchedule = (items: ScheduleItem[]): ScheduleItem[] => {
    if (items.length === 0) return [];
    const newItems = [...items];
    for (let i = 1; i < newItems.length; i++) {
      const prevItem = newItems[i - 1];
      newItems[i] = {
        ...newItems[i],
        startTime: addMinutes(prevItem.startTime, prevItem.duration),
      };
    }
    return newItems;
  };

  // --- ACTIONS ---
  const onTimeChange = (_event: unknown, selectedDate?: Date) => {
    setShowTimePicker(false);
    if (selectedDate) {
      setNewTime(selectedDate);
      setNewTimeText(
        selectedDate.toLocaleTimeString("fr-FR", {
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        }),
      );
    }
  };

  const openTimingModal = (item?: ScheduleItem) => {
    if (item) {
      setEditingTimingId(item.id);
      setNewTimeText(item.startTime);
      setNewTimingTitle(item.title);
      setNewTimingType(item.type);
      setNewTimingDuration(item.duration.toString());
      const [hours, minutes] = item.startTime.split(":").map(Number);
      const d = new Date();
      d.setHours(hours);
      d.setMinutes(minutes);
      setNewTime(d);
    } else {
      setEditingTimingId(null);
      if (schedule.length > 0) {
        const last = schedule[schedule.length - 1];
        const predictedStart = addMinutes(last.startTime, last.duration);
        setNewTimeText(predictedStart);

        const [h, m] = predictedStart.split(":").map(Number);
        const d = new Date();
        d.setHours(h);
        d.setMinutes(m);
        setNewTime(d);
      } else {
        setNewTimeText("10:00");
        setNewTime(new Date());
      }
      setNewTimingTitle("");
      setNewTimingType("ROUND");
      setNewTimingDuration("15");
    }
    setShowTimingModal(true);
  };

  const saveTiming = () => {
    if (!newTimingTitle) {
      Alert.alert("Erreur", "Veuillez nommer ce créneau");
      return;
    }

    const duration = parseInt(newTimingDuration, 10) || 0;
    let newSchedule = [...schedule];

    if (editingTimingId) {
      newSchedule = newSchedule.map((item) => {
        if (item.id === editingTimingId) {
          return {
            ...item,
            startTime: newTimeText,
            type: newTimingType,
            title: newTimingTitle,
            duration,
          };
        }
        return item;
      });
      // Recalculate whole schedule from start or just from changed item?
      // Component logic was: recalculate everything.
      newSchedule = recalculateSchedule(newSchedule);
    } else {
      const newItem: ScheduleItem = {
        id: Date.now().toString(),
        startTime: newTimeText,
        type: newTimingType,
        title: newTimingTitle,
        duration,
      };
      newSchedule.push(newItem);
      // If we add at end, simpler, but if we inserted??
      // Component logic: push to end.
    }

    setSchedule(newSchedule);
    setShowTimingModal(false);
  };

  const removeTiming = (id: string) => {
    const filtered = schedule.filter((s) => s.id !== id);
    setSchedule(recalculateSchedule(filtered));
  };

  const handleDragEnd = (data: ScheduleItem[]) => {
    setSchedule(recalculateSchedule(data));
  };

  return {
    schedule,
    showTimingModal,
    setShowTimingModal,
    newTime,
    showTimePicker,
    setShowTimePicker,
    newTimeText,
    newTimingType,
    setNewTimingType,
    newTimingTitle,
    setNewTimingTitle,
    newTimingDuration,
    setNewTimingDuration,
    onTimeChange,
    openTimingModal,
    saveTiming,
    removeTiming,
    handleDragEnd,
    editingTimingId,
  };
};
