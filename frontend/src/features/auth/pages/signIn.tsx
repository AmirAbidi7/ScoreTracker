import { useSignIn, useSignUp, useSSO } from "@clerk/expo";
import { router } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { colors } from "../../../../constants/theme";
import { isExpoGo } from "../../../../infrastructure/auth/isExpoGo";
import { useWarmUpBrowser } from "../../../../infrastructure/auth/useWarmUpBrowser";
import { describeClerkError } from "../clerkErrors";

WebBrowser.maybeCompleteAuthSession();

const JOIN_ROUTE = "/(main)/(scoreTracking)/syncGame";

type Mode = "sign-in" | "sign-up";
type OAuthStrategy = "oauth_google" | "oauth_apple";

const afterAuth = (): void => {
  if (typeof router.canGoBack === "function" && router.canGoBack()) {
    router.back();
    return;
  }
  router.replace(JOIN_ROUTE);
};

export default function SignInScreen() {
  useWarmUpBrowser();
  const { signIn } = useSignIn();
  const { signUp } = useSignUp();
  const { startSSOFlow } = useSSO();

  const [mode, setMode] = useState<Mode>("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async (): Promise<void> => {
    const identifier = email.trim();
    if (identifier.length === 0) {
      setError("Enter your email address.");
      return;
    }
    if (password.length === 0) {
      setError("Enter your password.");
      return;
    }
    setPending(true);
    setError(null);
    try {
      if (mode === "sign-in") {
        const { error: signInError } = await signIn.password({ identifier, password });
        if (signInError) {
          setError(describeClerkError(signInError));
          return;
        }
        const { error: finalizeError } = await signIn.finalize();
        if (finalizeError) {
          setError(describeClerkError(finalizeError));
          return;
        }
        afterAuth();
      } else {
        const { error: signUpError } = await signUp.password({
          emailAddress: identifier,
          password,
        });
        if (signUpError) {
          setError(describeClerkError(signUpError));
          return;
        }
        const { error: sendError } = await signUp.verifications.sendEmailCode();
        if (sendError) {
          setError(describeClerkError(sendError));
          return;
        }
        router.push("/(auth)/verify");
      }
    } catch (cause) {
      setError(describeClerkError(cause));
    } finally {
      setPending(false);
    }
  };

  const oauth = async (strategy: OAuthStrategy): Promise<void> => {
    setPending(true);
    setError(null);
    try {
      const { createdSessionId, setActive } = await startSSOFlow({ strategy });
      if (createdSessionId && setActive) {
        await setActive({ session: createdSessionId });
        afterAuth();
      }
    } catch (cause) {
      setError(describeClerkError(cause));
    } finally {
      setPending(false);
    }
  };

  const appleInExpoGo = isExpoGo();

  return (
    <View className="bg-background flex-1 gap-6 p-8 pt-24">
      <Text className="text-white font-sans-bold text-2xl">
        {mode === "sign-in" ? "Sign in" : "Create an account"}
      </Text>

      {error !== null && (
        <Text testID="auth-error" className="text-red-500 font-sans-medium text-lg">
          {error}
        </Text>
      )}

      <View className="gap-2">
        <Text className="text-white font-sans-medium text-lg">Email</Text>
        <TextInput
          testID="auth-email-input"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          placeholder="you@example.com"
          placeholderTextColor={colors.grey}
          className="border border-white bg-black text-white font-sans-regular px-3 py-2"
        />
      </View>

      <View className="gap-2">
        <Text className="text-white font-sans-medium text-lg">Password</Text>
        <TextInput
          testID="auth-password-input"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          placeholder="••••••••"
          placeholderTextColor={colors.grey}
          className="border border-white bg-black text-white font-sans-regular px-3 py-2"
        />
      </View>

      <Pressable
        testID="auth-submit"
        onPress={() => void submit()}
        disabled={pending}
        className="border border-primary bg-black px-6 py-3"
      >
        <Text className="text-white font-sans-medium text-lg text-center">
          {pending ? "Working..." : mode === "sign-in" ? "Sign in" : "Sign up"}
        </Text>
      </Pressable>

      <Pressable
        testID="auth-mode-toggle"
        onPress={() => {
          setMode(mode === "sign-in" ? "sign-up" : "sign-in");
          setError(null);
        }}
      >
        <Text className="text-tertiary font-sans-regular text-md text-center">
          {mode === "sign-in" ? "New here? Create an account" : "Have an account? Sign in"}
        </Text>
      </Pressable>

      <View className="gap-4 pt-4">
        <Pressable
          testID="oauth-google"
          onPress={() => void oauth("oauth_google")}
          disabled={pending}
          className="border border-secondary bg-black px-6 py-3"
        >
          <Text className="text-white font-sans-medium text-lg text-center">
            Continue with Google
          </Text>
        </Pressable>

        {appleInExpoGo ? (
          <Text
            testID="apple-expo-note"
            style={{ color: colors.grey }}
            className="font-sans-regular text-md text-center"
          >
            Apple sign-in needs a development build. Email or Google work in Expo Go.
          </Text>
        ) : (
          <Pressable
            testID="oauth-apple"
            onPress={() => void oauth("oauth_apple")}
            disabled={pending}
            className="border border-secondary bg-black px-6 py-3"
          >
            <Text className="text-white font-sans-medium text-lg text-center">
              Continue with Apple
            </Text>
          </Pressable>
        )}
      </View>

      <View nativeID="clerk-captcha" />
    </View>
  );
}
