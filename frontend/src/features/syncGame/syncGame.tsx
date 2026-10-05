import { clsx } from "clsx";
import { router } from "expo-router";
import { useState, type ComponentProps } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { colors } from "../../../constants/theme";
import { useAppDispatch, useAppSelector } from "../../../store";
import {
  rejectionReason,
  type RejectionCarrier,
} from "../scoreTracking/rejectionReason";
import { createScoreboard, joinScoreboard } from "../scoreTracking/scoreTrackingThunks";
import BoardQrCode from "../scoreTracking/boardQrCode";
import QrScanner from "./qrScanner";

const Field = ({ label, ...input }: { label: string } & ComponentProps<typeof TextInput>) => (
  <View className="gap-2">
    <Text className="text-white font-sans-medium text-lg">{label}</Text>
    <TextInput
      placeholderTextColor={colors.grey}
      className="border border-white bg-black text-white font-sans-regular px-3 py-2"
      {...input}
    />
  </View>
);

const Button = ({
  label,
  onPress,
  testID,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  testID: string;
  disabled?: boolean;
}) => (
  <Pressable
    onPress={onPress}
    testID={testID}
    disabled={disabled}
    className={clsx("border border-primary bg-black px-6 py-3", disabled && "opacity-50")}
  >
    <Text className="text-white font-sans-medium text-lg text-center">{label}</Text>
  </Pressable>
);

const SCOREBOARD_ROUTE = "/(main)/(scoreTracking)/scoreTracking";

export default function SyncGame() {
  const dispatch = useAppDispatch();
  const [code, setCode] = useState("");
  const [gameName, setGameName] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState<"join" | "create" | null>(null);
  const [scanOpen, setScanOpen] = useState(false);

  const current = useAppSelector((state) => state.scoreboard.current);

  const run = async (
    kind: "join" | "create",
    attempt: () => Promise<RejectionCarrier | null>,
    fallback: string,
  ): Promise<void> => {
    setPending(kind);
    setFormError(null);

    try {
      const rejected = await attempt();
      if (rejected !== null) setFormError(rejectionReason(rejected) ?? fallback);
    } catch {
      setFormError(fallback);
    } finally {
      setPending(null);
    }
  };

  const onJoin = () => {
    const trimmed = code.trim().toUpperCase();
    if (trimmed.length !== 6) {
      setFormError("A scoreboard code is 6 characters");
      return;
    }
    void run(
      "join",
      async () => {
        const result = await dispatch(joinScoreboard(trimmed));
        return joinScoreboard.rejected.match(result) ? result : null;
      },
      "Couldn't join",
    );
  };

  const onCreate = () => {
    const name = gameName.trim();
    if (name.length === 0) {
      setFormError("Give the game a name");
      return;
    }
    void run(
      "create",
      async () => {
        const result = await dispatch(createScoreboard(name));
        return createScoreboard.rejected.match(result) ? result : null;
      },
      "Couldn't create",
    );
  };

  const onScanned = (data: string) => {
    setScanOpen(false);
    void run(
      "join",
      async () => {
        const result = await dispatch(joinScoreboard(data));
        if (joinScoreboard.rejected.match(result)) return result;
        router.replace(SCOREBOARD_ROUTE);
        return null;
      },
      "Couldn't join",
    );
  };

  if (scanOpen) {
    return (
      <View className="bg-black flex-1">
        <QrScanner onScanned={onScanned} onClose={() => setScanOpen(false)} />
      </View>
    );
  }

  if (current) {
    return (
      <View
        className="flex-1 bg-black items-center justify-center gap-4 px-8"
        testID="current-board"
      >
        <Text className="text-white font-sans-medium text-2xl">{current.gameName}</Text>
        <Text className="text-white font-sans-regular text-xl">
          Code:{" "}
          <Text testID="current-code" className="font-sans-bold text-primary">
            {current.code}
          </Text>
        </Text>
        <BoardQrCode code={current.code} />
        <Text className="text-white font-sans-regular text-md text-center">
          Share that code and anyone can follow this board live.
        </Text>
      </View>
    );
  }

  return (
    <ScrollView
      className="bg-black flex-1"
      contentContainerClassName="gap-8 p-8 pb-24"
      keyboardShouldPersistTaps="handled"
    >
      {formError !== null && (
        <Text testID="form-error" className="text-red-500 font-sans-medium text-lg">
          {formError}
        </Text>
      )}

      <View className="gap-4">
        <Text className="text-white font-sans-bold text-2xl">Join a game</Text>
        <Field
          label="Code"
          testID="code-input"
          value={code}
          onChangeText={setCode}
          autoCapitalize="characters"
          autoCorrect={false}
          placeholder="AB12CD"
        />
        <Button
          testID="join-button"
          label={pending === "join" ? "Joining..." : "Join"}
          onPress={onJoin}
          disabled={pending !== null}
        />
        <Button
          testID="scan-button"
          label="Scan"
          onPress={() => setScanOpen(true)}
          disabled={pending !== null}
        />
      </View>

      <View className="gap-4">
        <Text className="text-white font-sans-bold text-2xl">Start a game</Text>
        <Field
          label="Game name"
          testID="game-name-input"
          value={gameName}
          onChangeText={setGameName}
          placeholder="Catan"
        />
        <Button
          testID="create-button"
          label={pending === "create" ? "Creating..." : "Create"}
          onPress={onCreate}
          disabled={pending !== null}
        />
      </View>
    </ScrollView>
  );
}
