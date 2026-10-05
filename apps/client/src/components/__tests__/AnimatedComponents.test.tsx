import React from "react";
import { Text } from "react-native";
import { fireEvent, render } from "@testing-library/react-native";
import { FadeInView, ScaleButton } from "../AnimatedComponents";

jest.mock("react-native-reanimated", () =>
  require("../../__tests__/mocks/mockReanimated"),
);

describe("AnimatedComponents", () => {
  it("renders FadeInView children", async () => {
    const { getByText } = await render(
      <FadeInView>
        <Text>Contenu</Text>
      </FadeInView>,
    );

    expect(getByText("Contenu")).toBeTruthy();
  });

  it("calls ScaleButton onPress", async () => {
    const onPress = jest.fn();
    const { getByText } = await render(
      <ScaleButton onPress={onPress}>
        <Text>Cliquer</Text>
      </ScaleButton>,
    );

    await fireEvent.press(getByText("Cliquer"));
    expect(onPress).toHaveBeenCalled();
  });
});
