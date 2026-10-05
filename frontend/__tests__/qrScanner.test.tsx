/// <reference types="jest" />
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { Linking } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import QrScanner from "../src/features/syncGame/qrScanner";

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
  const cleanups: Array<(() => void) | void> = [];
  return {
    router: { replace: jest.fn() },
    cleanups,
    useFocusEffect: (effect: () => (() => void) | void) => {
      React.useEffect(() => {
        const cleanup = effect();
        cleanups.push(cleanup);
        return cleanup;
      }, [effect]);
    },
  };
});

type PermissionState = {
  granted: boolean;
  canAskAgain: boolean;
  status: "granted" | "denied" | "undetermined";
};

const camera = CameraView as unknown as jest.Mock & {
  isAvailableAsync: jest.Mock;
};
const permissions = useCameraPermissions as unknown as jest.Mock;
const { cleanups } = jest.requireMock("expo-router") as {
  cleanups: Array<(() => void) | void>;
};

const granted: PermissionState = { granted: true, canAskAgain: true, status: "granted" };
const requestPermission = jest.fn();

const renderScanner = async (
  props: Partial<React.ComponentProps<typeof QrScanner>> = {},
): Promise<void> => {
  await render(<QrScanner onScanned={() => {}} onClose={() => {}} {...props} />);
};

const blurTab = async (): Promise<void> => {
  const cleanup = cleanups[cleanups.length - 1];
  if (typeof cleanup !== "function") throw new Error("the scanner never registered a focus effect");
  await act(async () => {
    cleanup();
  });
};

const scan = async (data: string): Promise<void> => {
  await act(async () => {
    screen.getByTestId("camera-view").props.onBarcodeScanned({ data, type: "qr" });
  });
};

beforeEach(() => {
  jest.resetAllMocks();
  cleanups.length = 0;
  camera.isAvailableAsync.mockResolvedValue(true);
  permissions.mockReturnValue([granted, requestPermission]);
  jest.spyOn(Linking, "openSettings").mockResolvedValue(undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("camera availability", () => {
  it("shows an unavailable state instead of a broken preview when there is no camera", async () => {
    camera.isAvailableAsync.mockResolvedValue(false);

    await renderScanner();

    await waitFor(() => expect(screen.getByTestId("scanner-unavailable")).toBeOnTheScreen());
    expect(screen.queryByTestId("camera-view")).toBeNull();
  });

  it("asks for the camera while availability is still being checked", async () => {
    camera.isAvailableAsync.mockReturnValue(new Promise(() => {}));

    await renderScanner();

    expect(screen.getByTestId("scanner-loading")).toBeOnTheScreen();
    expect(screen.queryByTestId("camera-view")).toBeNull();
  });
});

describe("permissions", () => {
  it("asks for permission when none has been granted yet", async () => {
    permissions.mockReturnValue([
      { granted: false, canAskAgain: true, status: "undetermined" },
      requestPermission,
    ]);

    await renderScanner();

    expect(screen.getByTestId("scanner-permission")).toBeOnTheScreen();
    expect(screen.queryByTestId("camera-view")).toBeNull();

    await fireEvent.press(screen.getByTestId("request-permission"));

    expect(requestPermission).toHaveBeenCalledTimes(1);
  });

  it("routes to Settings when the denial is permanent instead of asking again", async () => {
    permissions.mockReturnValue([
      { granted: false, canAskAgain: false, status: "denied" },
      requestPermission,
    ]);

    await renderScanner();

    expect(screen.queryByTestId("request-permission")).toBeNull();
    await fireEvent.press(screen.getByTestId("open-settings"));

    expect(Linking.openSettings).toHaveBeenCalledTimes(1);
    expect(requestPermission).not.toHaveBeenCalled();
  });

  it("stays on loading while the permission hook returns undefined", async () => {
    permissions.mockReturnValue([undefined, requestPermission]);

    await renderScanner();

    await waitFor(() => expect(camera.isAvailableAsync).toHaveBeenCalled());
    expect(screen.getByTestId("scanner-loading")).toBeOnTheScreen();
    expect(screen.queryByTestId("camera-view")).toBeNull();
  });
});

describe("the live preview", () => {
  it("scans qr codes only, and hands the raw payload out once", async () => {
    const onScanned = jest.fn();
    await renderScanner({ onScanned });

    await screen.findByTestId("camera-view");
    expect(screen.getByTestId("camera-view").props.barcodeScannerSettings).toEqual({
      barcodeTypes: ["qr"],
    });

    await scan("AB12CD");
    await scan("AB12CD");

    expect(onScanned).toHaveBeenCalledTimes(1);
    expect(onScanned).toHaveBeenCalledWith("AB12CD");
  });

  it("unmounts the preview when the tab loses focus", async () => {
    await renderScanner();

    await screen.findByTestId("camera-view");

    await blurTab();

    expect(screen.queryByTestId("camera-view")).toBeNull();
  });

  it("leaves without scanning when closed", async () => {
    const onScanned = jest.fn();
    const onClose = jest.fn();
    await renderScanner({ onScanned, onClose });

    await screen.findByTestId("camera-view");
    await fireEvent.press(screen.getByTestId("scanner-close"));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onScanned).not.toHaveBeenCalled();
  });
});

describe("torch", () => {
  const previewReady = async (): Promise<void> => {
    await act(async () => {
      screen.getByTestId("camera-view").props.onCameraReady();
    });
  };

  it("keeps the torch off limits until the preview is live", async () => {
    await renderScanner();

    await screen.findByTestId("camera-view");
    expect(screen.getByTestId("torch-toggle")).toBeDisabled();

    await previewReady();

    expect(screen.getByTestId("torch-toggle")).not.toBeDisabled();
  });

  it("starts off and toggles the camera torch on press", async () => {
    await renderScanner();

    await screen.findByTestId("camera-view");
    await previewReady();
    expect(screen.getByTestId("camera-view").props.enableTorch).toBe(false);

    await fireEvent.press(screen.getByTestId("torch-toggle"));

    expect(screen.getByTestId("camera-view").props.enableTorch).toBe(true);

    await fireEvent.press(screen.getByTestId("torch-toggle"));

    expect(screen.getByTestId("camera-view").props.enableTorch).toBe(false);
  });

  it("stays off limits when the device reports no torch", async () => {
    await renderScanner({ torchAvailable: false });

    await screen.findByTestId("camera-view");
    await previewReady();

    expect(screen.getByTestId("torch-toggle")).toBeDisabled();
    expect(screen.getByTestId("camera-view").props.enableTorch).toBe(false);
  });
});
