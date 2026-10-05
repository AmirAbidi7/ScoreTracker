/// <reference types="jest" />
jest.mock("@clerk/expo");
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { describeClerkError } from "../src/features/auth/clerkErrors";
import SignInScreen from "../src/features/auth/pages/signIn";
import VerifyScreen from "../src/features/auth/pages/verify";

jest.mock("expo-router", () => ({ router: { push: jest.fn(), replace: jest.fn() } }));

const clerk = jest.requireMock("@clerk/expo") as {
  __clerkState: {
    signInResult: unknown;
    signUpResult: unknown;
    verificationResult: unknown;
    ssoResult: unknown;
  };
  __clerkReset: () => void;
};

beforeEach(() => {
  clerk.__clerkReset();
  // The form tests cover the configured path; missing-key has its own suite.
  process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY = "pk_test_configured";
});

afterEach(() => {
  delete process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY;
});

describe("auth screens: email sign-in", () => {
  test("the sign-in form renders in the app theme", async () => {
    await render(<SignInScreen />);

    expect(screen.getByTestId("auth-email-input")).toBeTruthy();
    expect(screen.getByTestId("auth-password-input")).toBeTruthy();
    expect(screen.getByTestId("auth-submit")).toBeTruthy();
    expect(screen.getByTestId("oauth-google")).toBeTruthy();
  });

  test("signing in calls Clerk with the identifier and password", async () => {
    const expo = jest.requireMock("@clerk/expo") as {
      __signIn: { password: jest.Mock; finalize: jest.Mock };
    };
    expo.__signIn.password.mockResolvedValue({ error: null });
    expo.__signIn.finalize.mockResolvedValue({ error: null });

    await render(<SignInScreen />);
    await fireEvent.changeText(screen.getByTestId("auth-email-input"), "a@b.c");
    await fireEvent.changeText(screen.getByTestId("auth-password-input"), "s3cret!!");
    await fireEvent.press(screen.getByTestId("auth-submit"));

    await waitFor(() => {
      expect(expo.__signIn.password).toHaveBeenCalledWith({
        identifier: "a@b.c",
        password: "s3cret!!",
      });
    });
  });

  test("a Clerk failure surfaces as a sentence, not a code", async () => {
    const expo = jest.requireMock("@clerk/expo") as {
      __signIn: { password: jest.Mock };
    };
    expo.__signIn.password.mockResolvedValue({ error: { errors: [{ code: "form_password_incorrect" }] } });

    await render(<SignInScreen />);
    await fireEvent.changeText(screen.getByTestId("auth-email-input"), "a@b.c");
    await fireEvent.changeText(screen.getByTestId("auth-password-input"), "wrong");
    await fireEvent.press(screen.getByTestId("auth-submit"));

    await screen.findByText("Incorrect password. Try again.");
  });

  test("switching to sign-up collects a code after creating the account", async () => {
    const expo = jest.requireMock("@clerk/expo") as {
      __signUp: { password: jest.Mock; verifications: { sendEmailCode: jest.Mock } };
    };
    expo.__signUp.password.mockResolvedValue({ error: null });
    expo.__signUp.verifications.sendEmailCode.mockResolvedValue({ error: null });

    await render(<SignInScreen />);
    await fireEvent.press(screen.getByTestId("auth-mode-toggle"));
    await fireEvent.changeText(screen.getByTestId("auth-email-input"), "n@b.c");
    await fireEvent.changeText(screen.getByTestId("auth-password-input"), "s3cret!!");
    await fireEvent.press(screen.getByTestId("auth-submit"));

    await waitFor(() => {
      expect(expo.__signUp.password).toHaveBeenCalledWith({ emailAddress: "n@b.c", password: "s3cret!!" });
    });
  });
});

describe("auth screens: verification code step", () => {
  test("the verify screen submits the code", async () => {
    const expo = jest.requireMock("@clerk/expo") as {
      __signUp: { verifications: { verifyEmailCode: jest.Mock }; finalize: jest.Mock };
    };
    expo.__signUp.verifications.verifyEmailCode.mockResolvedValue({ error: null });
    expo.__signUp.finalize.mockResolvedValue({ error: null });

    await render(<VerifyScreen />);
    await fireEvent.changeText(screen.getByTestId("auth-code-input"), "123456");
    await fireEvent.press(screen.getByTestId("auth-verify"));

    await waitFor(() => {
      expect(expo.__signUp.verifications.verifyEmailCode).toHaveBeenCalledWith({ code: "123456" });
    });
  });
});

describe("auth screens: OAuth buttons", () => {
  test("Google starts a browser SSO flow", async () => {
    const expo = jest.requireMock("@clerk/expo") as {
      __sso: { startSSOFlow: jest.Mock };
    };
    expo.__sso.startSSOFlow.mockResolvedValue({ createdSessionId: "sess_1" });

    await render(<SignInScreen />);
    await fireEvent.press(screen.getByTestId("oauth-google"));

    await waitFor(() => {
      expect(expo.__sso.startSSOFlow).toHaveBeenCalledWith({ strategy: "oauth_google" });
    });
  });
});

describe("describeClerkError", () => {
  test("known codes map to sentences and unknown errors fall back", () => {
    expect(describeClerkError({ errors: [{ code: "form_password_incorrect" }] })).toBe(
      "Incorrect password. Try again.",
    );
    expect(describeClerkError({ errors: [{ code: "form_identifier_not_found" }] })).toBe(
      "No account uses that email. Check it or sign up.",
    );
    expect(describeClerkError(new Error("boom"))).toBe("boom");
    expect(describeClerkError(new Error("   "))).toBe("Something went wrong");
    expect(describeClerkError(null)).toBe("Something went wrong");
  });
});
