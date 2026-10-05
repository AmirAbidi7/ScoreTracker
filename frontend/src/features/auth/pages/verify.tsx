import { useSignUp } from "@clerk/expo";
import { router } from "expo-router";
import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { colors } from "../../../../constants/theme";
import { describeClerkError } from "../clerkErrors";

const JOIN_ROUTE = "/(main)/(scoreTracking)/syncGame";

export default function VerifyScreen() {
  const { signUp } = useSignUp();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const verify = async (): Promise<void> => {
    const trimmed = code.trim();
    if (trimmed.length === 0) {
      setError("Enter the 6-digit code we emailed you.");
      return;
    }
    setPending(true);
    setError(null);
    try {
      const { error: verifyError } = await signUp.verifications.verifyEmailCode({
        code: trimmed,
      });
      if (verifyError) {
        setError(describeClerkError(verifyError));
        return;
      }
      const { error: finalizeError } = await signUp.finalize();
      if (finalizeError) {
        setError(describeClerkError(finalizeError));
        return;
      }
      router.replace(JOIN_ROUTE);
    } catch (cause) {
      setError(describeClerkError(cause));
    } finally {
      setPending(false);
    }
  };

  return (
    <View className="bg-background flex-1 gap-6 p-8 pt-24">
      <Text className="text-white font-sans-bold text-2xl">Check your email</Text>
      <Text style={{ color: colors.grey }} className="font-sans-regular text-lg">
        Enter the verification code to finish creating your account.
      </Text>

      {error !== null && (
        <Text testID="auth-error" className="text-red-500 font-sans-medium text-lg">
          {error}
        </Text>
      )}

      <TextInput
        testID="auth-code-input"
        value={code}
        onChangeText={setCode}
        keyboardType="numeric"
        placeholder="123456"
        placeholderTextColor={colors.grey}
        className="border border-white bg-black text-white font-sans-regular px-3 py-2"
      />

      <Pressable
        testID="auth-verify"
        onPress={() => void verify()}
        disabled={pending}
        className="border border-primary bg-black px-6 py-3"
      >
        <Text className="text-white font-sans-medium text-lg text-center">
          {pending ? "Verifying..." : "Verify"}
        </Text>
      </Pressable>
    </View>
  );
}
