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
    startup_script?: string;
    welcomeMessage?: string;
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
  artifactManager: any | null;
  defaultProject: string | null;
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
  artifactManager: null,
  defaultProject: null,
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

      // Add connection guard - but allow reconnection if user/server are missing
      if (
        (state.isConnecting || state.isConnected) &&
        state.server &&
        state.user
      ) {
        console.log(
          "[HyphaStore] Already connected with user and server, skipping...",
        );
        return state.server;
      }

      // If already connecting, wait for it to complete
      if (state.isConnecting) {
        console.log("[HyphaStore] Already connecting, waiting...");
        // Poll for connection completion
        let attempts = 0;
        while (state.isConnecting && attempts < 30) {
          // Wait up to 15 seconds
          await new Promise((resolve) => setTimeout(resolve, 500));
          const currentState = get();
          if (!currentState.isConnecting) {
            return currentState.server;
          }
          attempts++;
        }
      }

      set((state) => ({ ...state, isConnecting: true }));

      try {
        console.log("[HyphaStore] Connecting to Hypha server...");

        let client = state.client;
        if (!client) {
          client = await hyphaWebsocketClient.connectToServer({
            server_url: config.server_url,
            token: config.token,
            method_timeout: config.method_timeout || 180000,
          });

          set((state) => ({ ...state, client }));
        } else {
          // If we have a client but it's disconnected, reconnect
          try {
            // Test the connection
            await client.getServices();
          } catch (error) {
            console.log(
              "[HyphaStore] Existing client disconnected, reconnecting...",
            );
            client = await hyphaWebsocketClient.connectToServer({
              server_url: config.server_url,
              token: config.token,
              method_timeout: config.method_timeout || 180000,
            });
            set((state) => ({ ...state, client }));
          }
        }

        // Get artifact manager service
        const artifactManager = await client.getService(
          "public/artifact-manager",
        );

        // Get user from client config
        const user = client.config?.user;
        if (user) {
          // Save user to localStorage
          localStorage.setItem("user", JSON.stringify(user));
        }

        set((state) => ({
          ...state,
          server: client,
          user: user || null,
          artifactManager,
          isConnected: true,
          isConnecting: false,
        }));

        console.log("[HyphaStore] Connected to Hypha server:", {
          user: user?.email || "No user",
          isConnected: true,
        });

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

    // Initialize default project for file uploads
    async initializeDefaultProject() {
      // Retry logic for connection timing issues
      let retries = 3;
      let delay = 1000;
      let state = get();

      while (retries > 0) {
        state = get(); // Refresh state on each retry

        console.log(
          `[HyphaStore] Checking connection state - Server: ${!!state.server}, User: ${!!state.user}, Connected: ${state.isConnected}`,
        );

        if (!state.server || !state.user) {
          console.warn(
            `[HyphaStore] Cannot initialize default project - no server connection or user (${retries} retries left)`,
          );
          console.warn(`[HyphaStore] State details:`, {
            hasServer: !!state.server,
            hasUser: !!state.user,
            userEmail: state.user?.email,
            isConnected: state.isConnected,
            isConnecting: state.isConnecting,
          });

          if (retries > 1) {
            await new Promise((resolve) => setTimeout(resolve, delay));
            retries--;
            delay *= 2; // exponential backoff
            continue;
          } else {
            throw new Error("Not authenticated or server not available");
          }
        } else {
          console.log(
            `[HyphaStore] Connection verified - proceeding with project initialization`,
          );
          break; // Connection is available
        }
      }

      if (state.defaultProject) {
        console.log(
          "[HyphaStore] Default project already exists:",
          state.defaultProject,
        );
        return state.defaultProject;
      }

      try {
        console.log("[HyphaStore] Initializing default project...");

        // Get artifact manager from server
        const artifactManager = await state.server.getService(
          "public/artifact-manager",
        );

        // First ensure the parent collection exists
        try {
          console.log("[HyphaStore] Checking for projects collection...");
          // Try to read the collection
          await artifactManager.read({
            artifact_id: "agent-lab-projects",
            _rkwargs: true,
          });
          console.log("[HyphaStore] Projects collection exists");
        } catch (error) {
          console.warn(
            "[HyphaStore] Projects collection not found, creating...",
          );
          // Collection doesn't exist, create it
          try {
            const collection = await artifactManager.create({
              alias: "agent-lab-projects",
              type: "collection",
              manifest: {
                name: "Agent Lab Projects",
                description: "Collection of Agent Lab projects",
                version: "0.1.0",
                type: "collection",
              },
              config: {
                permissions: { "*": "r", "@": "r+" },
              },
              _rkwargs: true,
            });
            console.log(
              "[HyphaStore] Created projects collection:",
              collection,
            );
          } catch (createError) {
            console.error(
              "[HyphaStore] Failed to create projects collection:",
              createError,
            );
            throw createError;
          }
        }

        // Check if default project already exists
        try {
          const existingProject = await artifactManager.read({
            artifact_id: "agent-lab-default-project",
            _rkwargs: true,
          });

          console.log(
            "[HyphaStore] Default project already exists, using existing:",
            existingProject.id,
          );
          set((state) => ({ ...state, defaultProject: existingProject.id }));
          return existingProject.id;
        } catch (readError) {
          // Project doesn't exist, create it
          console.log(
            "[HyphaStore] Default project not found, creating new one...",
          );

          const project = await artifactManager.create({
            parent_id: "agent-lab-projects",
            alias: "agent-lab-default-project",
            type: "project",
            manifest: {
              name: "Default Chat Project",
              description: "Default project for chat file uploads",
              version: "0.1.0",
              type: "project",
              created_at: new Date().toISOString(),
            },
            config: {
              permissions: { "*": "r", "@": "r+" },
            },
            _rkwargs: true,
          });

          console.log("[HyphaStore] Created default project:", project.id);
          set((state) => ({ ...state, defaultProject: project.id }));
          return project.id;
        }
      } catch (error) {
        console.error(
          "[HyphaStore] Error initializing default project:",
          error,
        );
        throw new Error(
          `Failed to initialize default project: ${error instanceof Error ? error.message : "Unknown error"}`,
        );
      }
    },

    // Upload file to default project
    async uploadFileToProject(
      file: File,
      onProgress?: (progress: number) => void,
    ): Promise<void> {
      const state = get();

      if (!state.artifactManager || !state.defaultProject) {
        throw new Error("No artifact manager or default project available");
      }

      try {
        console.log(
          "[HyphaStore] Uploading file to default project:",
          file.name,
        );

        // Get presigned URL for upload
        const putUrl = await state.artifactManager.put_file({
          artifact_id: state.defaultProject,
          file_path: file.name,
          _rkwargs: true,
        });

        // Upload file with progress tracking
        const response = await fetch(putUrl, {
          method: "PUT",
          body: file,
          headers: {
            "Content-Type": "",
          },
        });

        if (!response.ok) {
          throw new Error(`Upload failed with status: ${response.status}`);
        }

        console.log("[HyphaStore] File uploaded successfully:", file.name);
      } catch (error) {
        console.error("[HyphaStore] Error uploading file:", error);
        throw error;
      }
    },

    // List files in default project
    async listProjectFiles(): Promise<any[]> {
      const state = get();

      if (!state.artifactManager || !state.defaultProject) {
        return [];
      }

      try {
        const fileList = await state.artifactManager.list_files({
          artifact_id: state.defaultProject,
          version: "stage",
          _rkwargs: true,
        });

        return fileList || [];
      } catch (error) {
        console.error("[HyphaStore] Error listing project files:", error);
        return [];
      }
    },
  }),
  {
    name: "hypha-store",
  },
);
