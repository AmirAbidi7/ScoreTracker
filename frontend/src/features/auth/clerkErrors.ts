const SENTENCES: Record<string, string> = {
  form_identifier_not_found: "No account uses that email. Check it or sign up.",
  form_password_incorrect: "Incorrect password. Try again.",
  form_password_length_too_short: "Passwords need at least 8 characters.",
  form_password_pwned: "That password has appeared in a breach. Pick another.",
  form_username_invalid_length: "Check the username and try again.",
  form_param_format_invalid: "Check the highlighted field and try again.",
  verification_failed: "That code did not work. Check it and try again.",
  verification_expired: "That code expired. Ask for a new one.",
  session_exists: "You are already signed in on this device.",
  oauth_access_denied: "The provider refused access. Try again.",
  not_allowed_access: "This sign-in method is not enabled. Use email instead.",
  captcha_invalid: "Complete the captcha and try again.",
};

const firstCode = (error: unknown): string | null => {
  if (typeof error !== "object" || error === null) return null;
  const errors = (error as { errors?: unknown }).errors;
  if (!Array.isArray(errors)) return null;
  const code = (errors[0] as { code?: unknown } | undefined)?.code;
  return typeof code === "string" ? code : null;
};

export const describeClerkError = (error: unknown): string => {
  const sentence = SENTENCES[firstCode(error) ?? ""];
  if (sentence) return sentence;
  if (error instanceof Error && error.message.trim().length > 0) return error.message;
  return "Something went wrong";
};
