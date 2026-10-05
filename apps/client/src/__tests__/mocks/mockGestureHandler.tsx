import React from "react";

export const mockGesture = {
  Pan: jest.fn().mockReturnThis(),
  enabled: jest.fn().mockReturnThis(),
  runOnJS: jest.fn().mockReturnThis(),
  activeOffsetX: jest.fn().mockReturnThis(),
  activeOffsetY: jest.fn().mockReturnThis(),
  failOffsetX: jest.fn().mockReturnThis(),
  onBegin: jest.fn().mockReturnThis(),
  onStart: jest.fn().mockReturnThis(),
  onUpdate: jest.fn().mockReturnThis(),
  onEnd: jest.fn().mockReturnThis(),
  onFinalize: jest.fn().mockReturnThis(),
  Tap: jest.fn().mockReturnThis(),
  Race: jest.fn((...gestures: unknown[]) => gestures),
  Simultaneous: jest.fn((...gestures: unknown[]) => gestures),
};

export const Gesture = mockGesture;

interface GestureDetectorProps {
  gesture: ReturnType<typeof mockGesture.Pan>;
  children: React.ReactNode;
}

export const GestureDetector: React.FC<GestureDetectorProps> = ({ children }) =>
  children as React.ReactElement;

const MockGestureHandler = {
  Gesture: mockGesture,
  GestureDetector,
};

export default MockGestureHandler;
