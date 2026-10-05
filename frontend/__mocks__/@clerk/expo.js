export const __clerkState = {
  isSignedIn: false,
  userId: null,
  getToken: () => Promise.resolve(null),
};

export const __signIn = {
  password: jest.fn(async () => ({ error: null })),
  finalize: jest.fn(async () => ({ error: null })),
};

export const __signUp = {
  password: jest.fn(async () => ({ error: null })),
  finalize: jest.fn(async () => ({ error: null })),
  verifications: {
    sendEmailCode: jest.fn(async () => ({ error: null })),
    verifyEmailCode: jest.fn(async () => ({ error: null })),
  },
};

export const __sso = {
  startSSOFlow: jest.fn(async () => ({ createdSessionId: null })),
};

export const __clerkReset = () => {
  __clerkState.isSignedIn = false;
  __clerkState.userId = null;
  __clerkState.getToken = () => Promise.resolve(null);
  __signIn.password.mockClear();
  __signIn.finalize.mockClear();
  __signUp.password.mockClear();
  __signUp.finalize.mockClear();
  __signUp.verifications.sendEmailCode.mockClear();
  __signUp.verifications.verifyEmailCode.mockClear();
  __sso.startSSOFlow.mockClear();
};

export const useAuth = () => ({
  isLoaded: true,
  isSignedIn: __clerkState.isSignedIn,
  userId: __clerkState.userId,
  getToken: __clerkState.getToken,
  signOut: jest.fn(async () => {}),
});

export const useUser = () => ({
  isLoaded: true,
  isSignedIn: __clerkState.isSignedIn,
  user:
    __clerkState.isSignedIn && __clerkState.userId
      ? { id: __clerkState.userId, primaryEmailAddress: { emailAddress: "a@b.c" } }
      : null,
});

export const useSignIn = () => ({ isLoaded: true, signIn: __signIn, errors: null });
export const useSignUp = () => ({ isLoaded: true, signUp: __signUp, errors: null });
export const useSSO = () => ({ startSSOFlow: __sso.startSSOFlow });
export const useOAuth = () => ({ startOAuthFlow: __sso.startSSOFlow });
export const useClerk = () => ({ signOut: jest.fn(async () => {}) });

export const ClerkProvider = ({ children }) => children;
