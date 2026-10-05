import { CameraView, useCameraPermissions, type BarcodeScanningResult } from "expo-camera";
import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Linking, Pressable, Text, View } from "react-native";

export default function QrScanner({
  onScanned,
  onClose,
  torchAvailable = true,
}: {
  onScanned: (data: string) => void;
  onClose: () => void;
  torchAvailable?: boolean;
}) {
  const [permission, requestPermission] = useCameraPermissions();
  const [focused, setFocused] = useState(false);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const scanned = useRef(false);

  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => {
        setFocused(false);
        setCameraReady(false);
      };
    }, []),
  );

  useEffect(() => {
    let live = true;
    CameraView.isAvailableAsync()
      .then((ok) => {
        if (live) setAvailable(ok);
      })
      .catch(() => {
        if (live) setAvailable(false);
      });
    return () => {
      live = false;
    };
  }, []);

  const handleScanned = (result: BarcodeScanningResult) => {
    if (scanned.current) return;
    scanned.current = true;
    onScanned(result.data);
  };

  if (available === null || !permission) {
    return (
      <View className="flex-1 bg-black items-center justify-center" testID="scanner-loading">
        <Text className="text-white font-sans-regular text-lg">Starting the camera...</Text>
      </View>
    );
  }

  if (!available) {
    return (
      <View className="flex-1 bg-black items-center justify-center gap-4 px-8">
        <Text testID="scanner-unavailable" className="text-white font-sans-medium text-lg text-center">
          This device has no camera to scan with. Ask for the 6-character code instead.
        </Text>
        <Pressable onPress={onClose} testID="scanner-close" className="border border-primary px-6 py-3">
          <Text className="text-white font-sans-medium text-lg">Back</Text>
        </Pressable>
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View className="flex-1 bg-black items-center justify-center gap-4 px-8">
        <Text testID="scanner-permission" className="text-white font-sans-medium text-lg text-center">
          {permission.canAskAgain
            ? "Point the camera at a board QR to join it."
            : "Camera access was denied. Open Settings to turn it back on."}
        </Text>
        {permission.canAskAgain ? (
          <Pressable
            onPress={() => void requestPermission()}
            testID="request-permission"
            className="border border-primary px-6 py-3"
          >
            <Text className="text-white font-sans-medium text-lg">Allow camera</Text>
          </Pressable>
        ) : (
          <Pressable
            onPress={() => void Linking.openSettings()}
            testID="open-settings"
            className="border border-primary px-6 py-3"
          >
            <Text className="text-white font-sans-medium text-lg">Open Settings</Text>
          </Pressable>
        )}
        <Pressable onPress={onClose} testID="scanner-close" className="border border-secondary px-6 py-3">
          <Text className="text-white font-sans-medium text-lg">Back</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-black">
      {focused && (
        <CameraView
          testID="camera-view"
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
          onBarcodeScanned={handleScanned}
          onCameraReady={() => setCameraReady(true)}
          enableTorch={torchOn}
          style={{ flex: 1 }}
        />
      )}
      <View className="flex-row justify-between p-4">
        <Pressable
          onPress={() => setTorchOn((on) => !on)}
          testID="torch-toggle"
          disabled={!torchAvailable || !cameraReady}
          accessibilityRole="button"
          accessibilityLabel={torchOn ? "Turn the torch off" : "Turn the torch on"}
          accessibilityState={{ disabled: !torchAvailable || !cameraReady }}
          className="border border-primary px-6 py-3"
          style={!torchAvailable || !cameraReady ? { opacity: 0.5 } : undefined}
        >
          <Text className="text-white font-sans-medium text-lg">
            {torchOn ? "Torch on" : "Torch"}
          </Text>
        </Pressable>
        <Pressable onPress={onClose} testID="scanner-close" className="border border-secondary px-6 py-3">
          <Text className="text-white font-sans-medium text-lg">Back</Text>
        </Pressable>
      </View>
    </View>
  );
}
