import { act, render, screen } from "@testing-library/react-native";
import React from "react";
import type { EntryQrBatch } from "../../utils/entryQr";
import { EntryQrCode } from "../EntryQrCode";

jest.mock("../../../../components/AppText");
jest.mock("../QRCodeView.native", () => {
  const { Text } = jest.requireActual("react-native");
  return {
    QRCodeView: ({ value }: { value: string }) => (
      <Text testID="qr-value">{value}</Text>
    ),
  };
});

const STEP = 59612345;
const BATCH: EntryQrBatch = {
  version: 3,
  keyId: "b3N-LHLYjEQ",
  licenseId: "lic-1",
  number: "FFD-1",
  holderName: "DUPONT Jean",
  stepSeconds: 30,
  toleranceSteps: 1,
  firstStep: STEP,
  signatures: ["a".repeat(86), "b".repeat(86)],
  coversUntil: new Date((STEP + 2) * 30 * 1000).toISOString(),
};

describe("EntryQrCode (#24)", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it("shows the static QR without a batch", async () => {
    await render(<EntryQrCode batch={null} fallbackValue="static" size={10} />);
    expect(screen.getByTestId("qr-value")).toHaveTextContent("static");
    expect(screen.queryByTestId("entry-qr-countdown")).toBeNull();
  });

  it("rotates the QR every step, with a countdown", async () => {
    jest.useFakeTimers({ now: (STEP * 30 + 25) * 1000 });
    await render(
      <EntryQrCode batch={BATCH} fallbackValue="static" size={10} />,
    );
    expect(
      JSON.parse(screen.getByTestId("qr-value").props.children),
    ).toMatchObject({ t: STEP, sig: "a".repeat(86) });
    expect(screen.getByTestId("entry-qr-countdown")).toHaveTextContent(
      "QR d'entrée sécurisé · se renouvelle dans 5 s",
    );

    await act(async () => {
      jest.advanceTimersByTime(6000);
    });
    expect(
      JSON.parse(screen.getByTestId("qr-value").props.children),
    ).toMatchObject({ t: STEP + 1, sig: "b".repeat(86) });
  });

  it("falls back to the static QR once the batch is exhausted", async () => {
    jest.useFakeTimers({ now: (STEP + 3) * 30 * 1000 });
    await render(
      <EntryQrCode batch={BATCH} fallbackValue="static" size={10} />,
    );
    expect(screen.getByTestId("qr-value")).toHaveTextContent("static");
  });
});
