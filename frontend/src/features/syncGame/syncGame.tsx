import { clsx } from "clsx";
import { useState, type ComponentProps } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { colors } from "../../../constants/theme";
import { useAppDispatch, useAppSelector } from "../../../store";
import {
  rejectionReason,
  type RejectionCarrier,
} from "../scoreTracking/rejectionReason";
import { createScoreboard, joinScoreboard } from "../scoreTracking/scoreTrackingThunks";

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

export default function SyncGame() {
  const dispatch = useAppDispatch();
  const [code, setCode] = useState("");
  const [gameName, setGameName] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState<"join" | "create" | null>(null);

  const current = useAppSelector((state) => state.scoreboard.current);

  /**
   * Runs one request and reports how it ended, so both buttons behave the same
   * way and neither has to invent its own idea of a failure.
   *
   * The thunks are dispatched rather than unwrapped so the *rejected action* is
   * what comes back: `unwrap()` throws the payload or the serialised error, and
   * those are the two `rejectionReason` has to tell apart to avoid answering a
   * good message with RTK's "Rejected" placeholder. A resolved attempt is not a
   * failure and its payload is a board rather than a message, so `match` — not
   * the shape of what came back — is what says which of the two this was.
   *
   * Nothing here writes board state. The store is the server's to change, and a
   * join that fails has to leave the user exactly where they were.
   */
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
      // Not reachable — `dispatch` settles a thunk as an action rather than
      // rejecting — and kept because the alternative is worse: an unexpected
      // throw would escape `void run(…)` as an unhandled rejection with the
      // button still reading "Joining..." and nothing on screen to say why.
      setFormError(fallback);
    } finally {
      setPending(null);
    }
  };

  const onJoin = () => {
    // Trimmed and uppercased here as well as in the thunk, deliberately. The
    // check below is the form's own, and it has to be reading the code the
    // server generates: `"  ab12cd  "` is a code with padding and `"  ab  "` is
    // four characters, which is only true once the padding is gone. The thunk
    // keeps its own copy of this because a thunk that only works from one screen
    // is not safe.
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

  /**
   * Already in a game: the share code is the only thing anyone else needs, and
   * a form asking for a code would be asking the user to rejoin what they are
   * already in. The board moves out of this tab when they leave or delete it.
   */
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
      // Both buttons sit under the keyboard on a phone, and without this the
      // first tap only puts the keyboard away.
      keyboardShouldPersistTaps="handled"
    >
      {/*
        Above the form, not below it: the keyboard covers the bottom half of the
        screen, which is where both buttons are, so a message at the end of the
        scroll is a message nobody reads.
      */}
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
          // No `maxLength`. A paste of " ab12cd " is eight characters with
          // padding around a perfectly good code, and a cap truncates the tail
          // off it — turning the one input this screen exists to accept into the
          // one it refuses. The length check in `onJoin` is what says so instead.
          placeholder="AB12CD"
        />
        <Button
          testID="join-button"
          label={pending === "join" ? "Joining..." : "Join"}
          onPress={onJoin}
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
