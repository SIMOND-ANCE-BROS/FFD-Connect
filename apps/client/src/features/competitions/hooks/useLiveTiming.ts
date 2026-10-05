import { useCallback, useEffect, useRef, useState } from "react";
import { io, Socket } from "socket.io-client";
import { API_URL } from "../../../config";
import { createLogger } from "../../../utils/logger";

const logger = createLogger("useLiveTiming");

/**
 * Structure d'une heat (manche) en cours
 */
export interface HeatData {
  id: string;
  competitionId: string;
  eventId: string;
  startTime?: string;
  endTime?: string;
  status?: string;
  [key: string]: unknown;
}

/**
 * Structure d'un résultat publié
 */
export interface ResultData {
  id: string;
  competitionId: string;
  eventId: string;
  heatId?: string;
  results?: Array<{
    coupleId: string;
    position: number;
    score?: number;
    [key: string]: unknown;
  }>;
  publishedAt?: string;
  [key: string]: unknown;
}

export interface LiveTimingState {
  currentHeat: HeatData | null;
  delayMinutes: number;
  lastResult: ResultData | null;
  isConnected: boolean;
}

export const useLiveTiming = (competitionId: string | undefined) => {
  const [state, setState] = useState<LiveTimingState>({
    currentHeat: null,
    delayMinutes: 0,
    lastResult: null,
    isConnected: false,
  });

  const socketRef = useRef<Socket | null>(null);

  const connect = useCallback(() => {
    if (!competitionId) return;

    // Use the base URL but for the 'live' namespace
    const socketUrl = API_URL.replace("/api", "");
    const socket = io(`${socketUrl}/live`, {
      transports: ["websocket"],
    });

    socket.on("connect", () => {
      logger.info("[useLiveTiming] Connected to gateway");
      setState((prev) => ({ ...prev, isConnected: true }));
      socket.emit("joinCompetition", competitionId);
    });

    socket.on("disconnect", () => {
      logger.info("[useLiveTiming] Disconnected from gateway");
      setState((prev) => ({ ...prev, isConnected: false }));
    });

    socket.on("heat_update", (data: HeatData) => {
      logger.debug("[useLiveTiming] Heat update:", data);
      setState((prev) => ({ ...prev, currentHeat: data }));
    });

    socket.on(
      "delay_update",
      (data: { competitionId: string; delayMinutes: number }) => {
        logger.debug("[useLiveTiming] Delay update:", data);
        if (data.competitionId === competitionId) {
          setState((prev) => ({ ...prev, delayMinutes: data.delayMinutes }));
        }
      },
    );

    socket.on("result_published", (data: ResultData) => {
      logger.info("[useLiveTiming] Result published:", data);
      setState((prev) => ({ ...prev, lastResult: data }));
    });

    socketRef.current = socket;
  }, [competitionId]);

  const disconnect = useCallback(() => {
    if (socketRef.current) {
      socketRef.current.emit("leaveCompetition", competitionId);
      socketRef.current.disconnect();
      socketRef.current = null;
    }
  }, [competitionId]);

  useEffect(() => {
    connect();
    return () => disconnect();
  }, [connect, disconnect]);

  return {
    state,
    actions: {
      reconnect: connect,
    },
  };
};
