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
  user: User | null;
  isConnecting: boolean;
  isConnected: boolean;
  resources: Resource[];
  resourceType: string | null;
  totalItems: number;
  itemsPerPage: number;
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
  user: null,
  isConnecting: false,
  isConnected: false,
  resources: [],
  resourceType: "agent",
  totalItems: 0,
  itemsPerPage: 12,
  defaultProject: null,
};

// Constants for API endpoints
const SITE_ID = "hypha-agents";
const SERVER_URL = "https://hypha.aicell.io";

// Simple token handling with automatic expiration cleanup
const getSavedToken = () => {
  if (typeof window === "undefined") return null;

  const token = localStorage.getItem("token");
  const tokenExpiry = localStorage.getItem("tokenExpiry");

  if (token && tokenExpiry) {
    if (new Date(tokenExpiry) > new Date()) {
      return token;
    } else {
      // Token expired, clean up
      localStorage.removeItem("token");
      localStorage.removeItem("tokenExpiry");
      localStorage.removeItem("user");
    }
  }
  return null;
};

// Simple authentication error detection
const isAuthenticationError = (error: any): boolean => {
  if (!error) return false;

  let errorMessage = "Unknown error";
  if (error && typeof error === "object" && "message" in error) {
    errorMessage = String(error.message);
  } else if (error && typeof error.toString === "function") {
    errorMessage = error.toString();
  } else if (typeof error === "string") {
    errorMessage = error;
  }

  return (
    errorMessage.includes("authentication") ||
    errorMessage.includes("token") ||
    errorMessage.includes("unauthorized") ||
    errorMessage.includes("Authentication failed") ||
    errorMessage.includes("403") ||
    errorMessage.includes("401")
  );
};

// Store the current server connection (not persisted)
let currentServer: any = null;
let connectionPromise: Promise<any> | null = null;

export const useHyphaStore = createPersistStore(
  { ...DEFAULT_HYPHA_STATE },
  (set, get) => ({
    setUser(user: User | null) {
      set((state) => ({ ...state, user }));
    },

    setResourceType(type: string | null) {
      set((state) => ({ ...state, resourceType: type }));
    },

    setResources(resources: Resource[]) {
      set((state) => ({ ...state, resources }));
    },

    setTotalItems(total: number) {
      set((state) => ({ ...state, totalItems: total }));
    },

    // Get the current server connection (creates one if needed)
    async getServer(): Promise<any> {
      console.log("[HyphaStore] getServer called");

      // If there's already a connection attempt in progress, wait for it
      if (connectionPromise) {
        console.log(
          "[HyphaStore] Connection attempt already in progress, waiting...",
        );
        try {
          return await connectionPromise;
        } catch (error) {
          console.log(
            "[HyphaStore] Previous connection attempt failed, will retry",
          );
          connectionPromise = null;
        }
      }

      const token = getSavedToken();
      if (!token) {
        // Debug: check what's actually in localStorage
        const rawToken = localStorage.getItem("token");
        const rawExpiry = localStorage.getItem("tokenExpiry");
        console.error(
          "[HyphaStore] No token available. Raw token:",
          !!rawToken,
          "Raw expiry:",
          rawExpiry,
        );
        throw new Error(
          "No authentication token available. Please log in first.",
        );
      }
      console.log("[HyphaStore] Token found:", token.substring(0, 20) + "...");

      // If we have a current server, test it
      if (currentServer) {
        try {
          console.log("[HyphaStore] Testing existing server connection...");
          await currentServer.listServices();
          console.log("[HyphaStore] Existing server connection is valid");
          return currentServer;
        } catch (error) {
          console.log(
            "[HyphaStore] Existing server disconnected, creating new connection...",
            error,
          );
          currentServer = null;
        }
      }

      // Create new connection with promise to prevent concurrent attempts
      console.log("[HyphaStore] Creating new server connection...");
      connectionPromise = (async () => {
        try {
          const server = await hyphaWebsocketClient.connectToServer({
            server_url: SERVER_URL,
            token: token,
            method_timeout: 180000,
          });

          currentServer = server;
          console.log(
            "[HyphaStore] New server connection created successfully",
          );
          return server;
        } catch (error) {
          console.error(
            "[HyphaStore] Failed to create server connection:",
            error,
          );
          currentServer = null;
          throw error;
        } finally {
          connectionPromise = null;
        }
      })();

      return await connectionPromise;
    },

    // Add method to handle authentication failures
    handleAuthenticationFailure() {
      console.warn(
        "[HyphaStore] Authentication failure detected, logging out user",
      );

      // Clear authentication data from localStorage
      if (typeof window !== "undefined") {
        localStorage.removeItem("token");
        localStorage.removeItem("tokenExpiry");
        localStorage.removeItem("user");
      }

      // Clear current server and connection promise
      currentServer = null;
      connectionPromise = null;

      // Reset state
      set(() => ({
        ...DEFAULT_HYPHA_STATE,
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
          "[HyphaStore] Already connected or connecting, skipping...",
        );
        // Check if we have a token before trying to get server
        const token = getSavedToken();
        if (!token) {
          console.warn(
            "[HyphaStore] Connected but no token available, forcing reconnection",
          );
          set((state) => ({
            ...state,
            isConnected: false,
            isConnecting: false,
          }));
          currentServer = null;
          // Continue with connection process below
        } else {
          const store = get() as any;
          return await store.getServer();
        }
      }

      set((state) => ({ ...state, isConnecting: true }));

      try {
        console.log("[HyphaStore] Connecting to Hypha server...");

        const server = await hyphaWebsocketClient.connectToServer({
          server_url: config.server_url,
          token: config.token,
          method_timeout: config.method_timeout || 180000,
        });

        // Set the current server
        currentServer = server;

        // Get user from server config
        const user = server.config?.user;
        if (user) {
          // Save user to localStorage
          localStorage.setItem("user", JSON.stringify(user));
        }

        set((state) => ({
          ...state,
          user: user || null,
          isConnected: true,
          isConnecting: false,
        }));

        console.log("[HyphaStore] Connected to Hypha server:", {
          user: user?.email || "No user",
          isConnected: true,
        });

        return server;
      } catch (error) {
        console.error("[HyphaStore] Failed to connect:", error);

        // Check if this is an authentication error
        if (isAuthenticationError(error)) {
          // Handle authentication failure by clearing state
          const store = get() as any;
          if (store.handleAuthenticationFailure) {
            store.handleAuthenticationFailure();
          }
        } else {
          set((state) => ({
            ...state,
            isConnected: false,
            isConnecting: false,
          }));
        }
        throw error;
      }
    },

    async disconnect() {
      if (currentServer) {
        try {
          await currentServer.disconnect();
        } catch (error) {
          console.error("[HyphaStore] Error during disconnect:", error);
        }
        currentServer = null;
      }

      // Clear connection promise
      connectionPromise = null;

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
          // Don't set isConnected: true here as it causes race conditions
          // Connection status should only be set when actual server connection is established
        }));
      }
    },

    // Initialize default project for file uploads
    async initializeDefaultProject() {
      const state = get();
      const store = get() as any; // Get store reference
      const token = getSavedToken();

      if (!token || !state.user) {
        throw new Error("Not authenticated or server not available");
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

        // Get server connection
        const server = await store.getServer();

        // Get artifact manager from server
        const artifactManager = await server.getService(
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
      const store = get() as any; // Get store reference

      if (!state.defaultProject) {
        await store.initializeDefaultProject();
      }

      try {
        console.log(
          "[HyphaStore] Uploading file to default project:",
          file.name,
        );

        const server = await store.getServer();
        const artifactManager = await server.getService(
          "public/artifact-manager",
        );

        // First, put the artifact into staging mode
        console.log("[HyphaStore] Enabling staging mode for artifact...");
        await artifactManager.edit({
          artifact_id: state.defaultProject!,
          stage: true,
          _rkwargs: true,
        });

        // Report initial progress
        if (onProgress) onProgress(25);

        // Get presigned URL for upload
        const putUrl = await artifactManager.put_file({
          artifact_id: state.defaultProject!,
          file_path: file.name,
          _rkwargs: true,
        });

        if (onProgress) onProgress(50);

        // Upload file using presigned URL
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

        if (onProgress) onProgress(100);
        console.log("[HyphaStore] File uploaded successfully:", file.name);
      } catch (error) {
        console.error("[HyphaStore] Error uploading file:", error);
        throw new Error(
          `Failed to upload file: ${error instanceof Error ? error.message : "Unknown error"}`,
        );
      }
    },

    // List files in default project
    async listProjectFiles(): Promise<any[]> {
      const state = get();
      const store = get() as any; // Get store reference

      if (!state.defaultProject) {
        return [];
      }

      try {
        const server = await store.getServer();
        const artifactManager = await server.getService(
          "public/artifact-manager",
        );

        const fileList = await artifactManager.list_files({
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
