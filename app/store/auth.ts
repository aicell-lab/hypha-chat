import { createPersistStore } from "../utils/store";

export interface User {
  email: string;
  id: string;
  name?: string;
}

export interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoggingIn: boolean;
  server?: any;
}

const DEFAULT_AUTH_STATE: AuthState = {
  user: null,
  token: null,
  isAuthenticated: false,
  isLoggingIn: false,
  server: undefined,
};

// Helper function to check if token is valid
export const getSavedToken = () => {
  if (typeof window === "undefined") return null;

  const token = localStorage.getItem("hypha_token");
  if (token) {
    const tokenExpiry = localStorage.getItem("hypha_token_expiry");
    if (tokenExpiry && new Date(tokenExpiry) > new Date()) {
      return token;
    }
  }
  return null;
};

export const useAuthStore = createPersistStore(
  { ...DEFAULT_AUTH_STATE },
  (set, get) => ({
    setUser(user: User | null) {
      if (typeof window !== "undefined" && user) {
        localStorage.setItem("hypha_user", JSON.stringify(user));
      }
      set((state) => ({
        ...state,
        user,
        isAuthenticated: !!user,
      }));
    },

    setToken(token: string | null) {
      if (typeof window !== "undefined") {
        if (token) {
          localStorage.setItem("hypha_token", token);
          localStorage.setItem(
            "hypha_token_expiry",
            new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString(),
          );
        } else {
          localStorage.removeItem("hypha_token");
          localStorage.removeItem("hypha_token_expiry");
        }
      }

      set((state) => ({
        ...state,
        token,
        isAuthenticated: !!token && !!state.user,
      }));
    },

    setServer(server: any) {
      set((state) => ({
        ...state,
        server,
      }));
    },

    setLoggingIn(isLoggingIn: boolean) {
      set((state) => ({
        ...state,
        isLoggingIn,
      }));
    },

    logout() {
      if (typeof window !== "undefined") {
        localStorage.removeItem("hypha_token");
        localStorage.removeItem("hypha_token_expiry");
        localStorage.removeItem("hypha_user");
      }

      set(() => ({
        ...DEFAULT_AUTH_STATE,
      }));
    },

    // Initialize auth state from localStorage
    initialize() {
      if (typeof window === "undefined") return;

      const token = getSavedToken();
      const userStr = localStorage.getItem("hypha_user");
      let user = null;

      if (userStr) {
        try {
          user = JSON.parse(userStr);
        } catch (e) {
          console.error("Failed to parse user from localStorage:", e);
        }
      }

      if (token && user) {
        set((state) => ({
          ...state,
          token,
          user,
          isAuthenticated: true,
        }));
      }
    },
  }),
  {
    name: "hypha-auth",
  },
);
