import { createPersistStore } from "../utils/store";
import { hyphaWebsocketClient } from "hypha-rpc";

export interface User {
  email: string;
  id: string;
  name?: string;
}

export interface Badge {
  url: string;
  icon?: string;
  label: string;
}

export interface Resource {
  id: string;
  name: string;
  description: string;
  tags: string[];
  config: any;
  type: string;
  created_at: number;
  last_modified: number;
  manifest: {
    name: string;
    authors?: string[];
    license?: string;
    version?: string;
    description: string;
    icon?: string;
    id_emoji?: string;
    tags?: string[];
    badges?: Badge[];
    covers?: string[];
    type?: string;
    documentation?: string;
  };
}

export interface HyphaState {
  client: any | null;
  user: User | null;
  server: any;
  isConnecting: boolean;
  isConnected: boolean;
  resources: Resource[];
  resourceType: string | null;
  totalItems: number;
  itemsPerPage: number;
}

interface ConnectConfig {
  server_url: string;
  token: string;
  method_timeout?: number;
}

interface LoginConfig {
  server_url: string;
  login_callback: (context: { login_url: string }) => void;
}

const DEFAULT_HYPHA_STATE: HyphaState = {
  client: null,
  user: null,
  server: null,
  isConnecting: false,
  isConnected: false,
  resources: [],
  resourceType: "agent",
  totalItems: 0,
  itemsPerPage: 12,
};

// Constants for API endpoints
const SITE_ID = "hypha-agents";
const SERVER_URL = "https://hypha.aicell.io";

// Move token logic outside of component
const getSavedToken = () => {
  if (typeof window === "undefined") return null;

  const token = localStorage.getItem("token");
  if (token) {
    const tokenExpiry = localStorage.getItem("tokenExpiry");
    if (tokenExpiry && new Date(tokenExpiry) > new Date()) {
      return token;
    }
  }
  return null;
};

export const useHyphaStore = createPersistStore(
  { ...DEFAULT_HYPHA_STATE },
  (set, get) => ({
    setUser(user: User | null) {
      set((state) => ({
        ...state,
        user,
      }));
    },

    setResourceType(type: string | null) {
      set((state) => ({
        ...state,
        resourceType: type,
      }));
    },

    setResources(resources: Resource[]) {
      set((state) => ({
        ...state,
        resources,
      }));
    },

    setTotalItems(total: number) {
      set((state) => ({
        ...state,
        totalItems: total,
      }));
    },

    async fetchResources(
      page: number = 1,
      searchQuery?: string,
    ): Promise<void> {
      try {
        if (page < 1) {
          page = 1;
        }

        const state = get();
        const offset = (page - 1) * state.itemsPerPage;

        // Construct the base URL
        let url = `${SERVER_URL}/${SITE_ID}/artifacts/agents/children?pagination=true&offset=${offset}&limit=${state.itemsPerPage}`;

        // Add type filter if resourceType is specified
        if (state.resourceType) {
          const filters = JSON.stringify({ type: state.resourceType });
          url += `&filters=${encodeURIComponent(filters)}`;
        }

        // Add search keywords if there's a search query
        if (searchQuery) {
          const keywords = searchQuery
            .split(",")
            .map((k) => k.trim())
            .join(",");
          url += `&keywords=${encodeURIComponent(keywords)}`;
        }

        const response = await fetch(url);
        const data = await response.json();

        set((state) => ({
          ...state,
          resources: data.items || [],
          totalItems: data.total || 0,
        }));
      } catch (error) {
        console.error("Error fetching resources:", error);
        set((state) => ({
          ...state,
          resources: [],
          totalItems: 0,
        }));
      }
    },

    async connect(config: ConnectConfig) {
      const state = get();

      // Add connection guard
      if (state.isConnecting || state.isConnected) {
        console.log(
          "[HyphaStore] Already connecting or connected, skipping...",
        );
        return;
      }

      set((state) => ({ ...state, isConnecting: true }));

      try {
        console.log("[HyphaStore] Connecting to Hypha server...");

        let client = state.client;
        if (!client) {
          client = await hyphaWebsocketClient.connectToServer({
            server_url: config.server_url,
            client_id: "hypha-chat-client",
            token: config.token,
            method_timeout: config.method_timeout || 180000,
          });

          set((state) => ({ ...state, client }));
        }

        set((state) => ({
          ...state,
          server: client,
          isConnected: true,
          isConnecting: false,
        }));

        console.log("[HyphaStore] Connected to Hypha server:");

        return client;
      } catch (error) {
        console.error("[HyphaStore] Failed to connect:", error);
        set((state) => ({
          ...state,
          isConnected: false,
          isConnecting: false,
        }));
        throw error;
      }
    },

    async disconnect() {
      const state = get();

      if (state.client) {
        try {
          await state.client.disconnect();
        } catch (error) {
          console.error("[HyphaStore] Error during disconnect:", error);
        }
      }

      // Clear localStorage
      if (typeof window !== "undefined") {
        localStorage.removeItem("token");
        localStorage.removeItem("tokenExpiry");
        localStorage.removeItem("user");
      }

      set(() => ({
        ...DEFAULT_HYPHA_STATE,
      }));
    },

    // Initialize from localStorage
    initialize() {
      if (typeof window === "undefined") return;

      const token = getSavedToken();
      const userStr = localStorage.getItem("user");
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
          user,
        }));
      }
    },
  }),
  {
    name: "hypha-store",
  },
);
