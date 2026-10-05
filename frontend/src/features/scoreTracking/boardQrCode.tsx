import { View } from "react-native";
import QRCode from "react-native-qrcode-svg";

export default function BoardQrCode({ code }: { code: string }) {
  return (
    <View
      testID="board-qr"
      accessibilityRole="image"
      accessibilityLabel={`QR code for ${code}`}
      className="bg-white p-3 self-center"
    >
      <QRCode value={code} size={160} backgroundColor="white" testID="board-qr-code" />
    </View>
  );
}
