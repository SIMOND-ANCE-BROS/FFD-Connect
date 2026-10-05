import React from "react";
import Svg, { Path } from "react-native-svg";

export interface TeamIconProps {
  size?: number;
  color?: string;
}

export const TeamIcon: React.FC<TeamIconProps> = ({
  size = 24,
  color = "currentColor",
}) => {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {/* Centre user (un peu plus grand, plus haut) */}
      <Path d="M12 10.5a2.7 2.7 0 1 0-2.7-2.7 2.7 2.7 0 0 0 2.7 2.7Z" />
      <Path d="M8.2 15.5c0-2.1 1.7-3.8 3.8-3.8s3.8 1.7 3.8 3.8" />

      {/* Left user (plus fin, légèrement derrière) */}
      <Path d="M7 10a2 2 0 1 0-2-2 2 2 0 0 0 2 2Z" />
      <Path d="M4.6 14c0-1.6 1.2-2.9 2.7-2.9" />

      {/* Right user (symétrique) */}
      <Path d="M17 10a2 2 0 1 0-2-2 2 2 0 0 0 2 2Z" />
      <Path d="M19.4 14c0-1.6-1.2-2.9-2.7-2.9" />
    </Svg>
  );
};
