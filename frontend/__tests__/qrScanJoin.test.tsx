/// <reference types="jest" />
import { configureStore } from "@reduxjs/toolkit";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { router } from "expo-router";
import { Provider } from "react-redux";
import { ApiClientError } from "../infrastructure/api/client";
import type { Scoreboard } from "../src/features/scoreTracking/domain/Scoreboard";
import {
  scoreboardService,
  type ScoreboardService,
} from "../src/features/scoreTracking/domain/ScoreboardService";
import reducer from "../src/features/scoreTracking/scoreTrackingSlice";
import JoinPage from "../src/features/syncGame/syncGame";

jest.mock("../src/features/scoreTracking/domain/ScoreboardService", () => ({
  scoreboardService: {
    joinScoreboard: jest.fn(),
    createScoreboard: jest.fn(),
    listScoreboards: jest.fn(),
    leaveScoreboard: jest.fn(),
    deleteCurrentScoreboard: jest.fn(),
    sendIntent: jest.fn(),
    subscribe: jest.fn(() => () => {}),
  },
}));

jest.mock("expo-camera", () => {
  const React = require("react");
  const { View } = require("react-native");
  const MockCameraView = (props: unknown) => <View {...(props as object)} />;
  MockCameraView.isAvailableAsync = jest.fn();
  return {
    __esModule: true,
    CameraView: MockCameraView,
    useCameraPermissions: jest.fn(),
  };
});

jest.mock("expo-router", () => {
  const React = require("react");
  return {
    router: { replace: jest.fn() },
    useFocusEffect: (effect: () => (() => void) | void) => {
      React.useEffect(() => effect(), [effect]);
    },
  };
});

jest.mock("react-native-qrcode-svg", () => {
  const React = require("react");
  const { View } = require("react-native");
  return { __esModule: true, default: (props: unknown) => <View {...(props as object)} /> };
});

const service = scoreboardService as jest.Mocked<ScoreboardService>;
const replace = router.replace as jest.MockedFunction<typeof router.replace>;
const { CameraView, useCameraPermissions } = jest.requireMock("expo-camera") as {
  CameraView: jest.Mock & { isAvailableAsync: jest.Mock };
  useCameraPermissions: jest.Mock;
};

const board: Scoreboard = {
  id: "board-1",
  gameName: "Catan",
  code: "AB12CD",
  players: [{ id: 1, name: "Amir", score: 0 }],
  updateTime: "2026-09-25T10:00:00.000Z",
  ownerId: "user_owner",
};

const makeStore = () => configureStore({ reducer: { scoreboard: reducer } });

const SCOREBOARD_ROUTE = "/(main)/(scoreTracking)/scoreTracking";

const openScanner = async (): Promise<void> => {
  await fireEvent.press(screen.getByTestId("scan-button"));
  await screen.findByTestId("camera-view");
};

const scan = async (data: string): Promise<void> => {
  await act(async () => {
    screen.getByTestId("camera-view").props.onBarcodeScanned({ data, type: "qr" });
  });
};

beforeEach(async () => {
  jest.resetAllMocks();
  service.joinScoreboard.mockResolvedValue(board);
  service.createScoreboard.mockResolvedValue(board);
  CameraView.isAvailableAsync.mockResolvedValue(true);
  useCameraPermissions.mockReturnValue([
    { granted: true, canAskAgain: true, status: "granted" },
    jest.fn(),
  ]);
  const store = makeStore();
  await render(
    <Provider store={store}>
      <JoinPage />
    </Provider>,
  );
});

describe("scanning a board QR", () => {
  it("offers a scan control on the Join tab", async () => {
    expect(screen.getByTestId("scan-button")).toBeOnTheScreen();
    expect(screen.queryByTestId("camera-view")).toBeNull();
  });

  it("normalizes the scanned payload through the same join as typed codes", async () => {
    await openScanner();

    await scan("  ab12cd  ");

    expect(service.joinScoreboard).toHaveBeenCalledTimes(1);
    expect(service.joinScoreboard).toHaveBeenCalledWith("AB12CD");
  });

  it("goes to the Scoreboard tab when the scanned join succeeds", async () => {
    await openScanner();

    await scan("AB12CD");

    await waitFor(() => expect(replace).toHaveBeenCalledWith(SCOREBOARD_ROUTE));
  });

  it("opens a scanner whose torch starts off limits until the preview is live", async () => {
    await openScanner();

    expect(screen.getByTestId("torch-toggle")).toBeDisabled();

    await act(async () => {
      screen.getByTestId("camera-view").props.onCameraReady();
    });

    expect(screen.getByTestId("torch-toggle")).not.toBeDisabled();
  });

  it("closes the scanner on first scan, so a held frame cannot join twice", async () => {
    let release!: (board: Scoreboard) => void;
    service.joinScoreboard.mockReturnValue(
      new Promise<Scoreboard>((resolve) => {
        release = resolve;
      }),
    );
    await openScanner();

    await scan("AB12CD");

    expect(service.joinScoreboard).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("camera-view")).toBeNull();

    await act(async () => {
      release(board);
    });

    await waitFor(() => expect(replace).toHaveBeenCalledWith(SCOREBOARD_ROUTE));
    expect(service.joinScoreboard).toHaveBeenCalledTimes(1);
  });

  it("shows the existing error when the scanned code joins nothing", async () => {
    service.joinScoreboard.mockRejectedValue(new ApiClientError("Scoreboard not found", 404));
    await openScanner();

    await scan("ZZZZZZ");

    await waitFor(() =>
      expect(screen.getByTestId("form-error")).toHaveTextContent("No scoreboard with that code"),
    );
    expect(replace).not.toHaveBeenCalled();
  });

  it("refuses a scanned payload that is not a 6-char code, like a typed one", async () => {
    await openScanner();

    await scan("https://example.com/boards/AB12CD");

    expect(service.joinScoreboard).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.getByTestId("form-error")).toHaveTextContent(
        "A scoreboard code is 6 characters",
      ),
    );
    expect(replace).not.toHaveBeenCalled();
  });
});
