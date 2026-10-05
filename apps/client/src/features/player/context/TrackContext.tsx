import React, { createContext, useContext, ReactNode } from "react";
import { TrackRepository } from "../services/TrackRepository";

const TrackContext = createContext<TrackRepository | null>(null);

interface TrackProviderProps {
  children: ReactNode;
  implementation: TrackRepository;
}

export const TrackProvider: React.FC<TrackProviderProps> = ({
  children,
  implementation,
}) => {
  return (
    <TrackContext.Provider value={implementation}>
      {children}
    </TrackContext.Provider>
  );
};

export const useTrackRepository = (): TrackRepository => {
  const context = useContext(TrackContext);
  if (!context) {
    throw new Error("useTrackRepository must be used within TrackProvider");
  }
  return context;
};
