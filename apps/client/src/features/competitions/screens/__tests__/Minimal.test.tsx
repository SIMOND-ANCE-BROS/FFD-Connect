import { render } from "@testing-library/react-native";
import React from "react";
import { Text } from "react-native";

describe("Minimal", () => {
  it("renders", async () => {
    const { getByText } = await render(<Text>Hello</Text>);
    expect(getByText("Hello")).toBeTruthy();
  });
});
