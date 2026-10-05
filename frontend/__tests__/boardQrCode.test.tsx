/// <reference types="jest" />
import { render, screen } from "@testing-library/react-native";
import QRCode from "react-native-qrcode-svg";
import BoardQrCode from "../src/features/scoreTracking/boardQrCode";

jest.mock("react-native-qrcode-svg", () => {
  const React = require("react");
  const { View } = require("react-native");
  const MockQr = jest.fn((props: unknown) => <View {...(props as object)} />);
  return { __esModule: true, default: MockQr };
});

const QrMock = QRCode as unknown as jest.Mock;

describe("BoardQrCode", () => {
  it("encodes exactly the 6-char code, nothing else", async () => {
    await render(<BoardQrCode code="AB12CD" />);

    expect(QrMock).toHaveBeenCalledWith(
      expect.objectContaining({ value: "AB12CD" }),
      undefined,
    );
    expect(screen.getByTestId("board-qr")).toBeOnTheScreen();
  });
});
