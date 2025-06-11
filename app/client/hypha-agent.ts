"use client";

import log from "loglevel";
import { hyphaWebsocketClient } from "hypha-rpc";
import { ChatOptions, LLMApi, LLMConfig, RequestMessage } from "./api";
import { ChatCompletionFinishReason, CompletionUsage } from "@mlc-ai/web-llm";

export interface AgentConfig {
  id: string;
  name: string;
  instructions?: string;
  kernelType?: "PYTHON" | "TYPESCRIPT" | "JAVASCRIPT";
  kernelEnvirons?: Record<string, string>;
  startupScript?: string;
  autoAttachKernel?: boolean;
  enablePlanning?: boolean;
  maxSteps?: number;
}

export interface AgentInfo {
  id: string;
  name: string;
  status?: string;
  created?: string;
}

export interface ChatResponse {
  type:
    | "text"
    | "text_chunk"
    | "error"
    | "function_call"
    | "function_call_output";
  content?: string;
  error?: string;
  name?: string;
  arguments?: any;
  call_id?: string;
}

export class HyphaAgentApi implements LLMApi {
  private server: any = null;
  private service: any = null;
  private agentId: string | null = null;
  private sessionId: string | null = null;
  private abortController: AbortController | null = null;
  private isConnected: boolean = false;

  constructor(
    private serverUrl: string = "https://hypha.aicell.io",
    private serviceId: string = "hypha-agents/deno-app-engine",
    private externalServer?: any,
  ) {}

  private getSavedToken(): string | null {
    if (typeof window === "undefined") return null;

    const token = localStorage.getItem("token");
    if (token) {
      const tokenExpiry = localStorage.getItem("tokenExpiry");
      if (tokenExpiry && new Date(tokenExpiry) > new Date()) {
        return token;
      }
    }
    return null;
  }

  async initialize() {
    if (this.isConnected) return;

    try {
      // Use external server if provided, otherwise create new connection
      if (this.externalServer) {
        log.info("[HyphaAgent] Using existing server connection...");

        this.server = this.externalServer;

        // Validate that the server has the required methods
        if (!this.server || typeof this.server.getService !== "function") {
          throw new Error(
            `Invalid server connection - missing getService method. Got: ${typeof this.server?.getService}. Server keys: ${Object.keys(
              this.server || {},
            )
              .slice(0, 10)
              .join(", ")}`,
          );
        }

        if (typeof this.server.listServices !== "function") {
          throw new Error(
            `Invalid server connection - missing listServices method. Got: ${typeof this.server?.listServices}. Server keys: ${Object.keys(
              this.server || {},
            )
              .slice(0, 10)
              .join(", ")}`,
          );
        }
      } else {
        log.warn(
          "[HyphaAgent] No external server provided, creating new connection...",
        );
        log.warn(
          "[HyphaAgent] This may cause 'Client already exists' errors if another connection exists",
        );
        // Get saved token from localStorage
        const token = this.getSavedToken();
        if (!token) {
          throw new Error(
            "No authentication token available. Please log in first.",
          );
        }

        log.info("[HyphaAgent] Connecting to Hypha server...");
        this.server = await hyphaWebsocketClient.connectToServer({
          server_url: this.serverUrl,
          token: token,
          method_timeout: 180000,
        });
      }

      log.info("[HyphaAgent] Getting service...");
      try {
        this.service = await this.server.getService(this.serviceId, {
          mode: "random",
        });
      } catch (error) {
        // If direct access fails, try to find it in the list of services
        log.info(
          "[HyphaAgent] Direct service access failed, listing all services...",
        );
        const services = await this.server.listServices();
        log.info(
          "[HyphaAgent] Available services:",
          services.map((s: any) => ({ id: s.id, name: s.name })),
        );

        this.service = services.find(
          (s: any) =>
            s.id === this.serviceId ||
            s.id.includes("deno-app-engine") ||
            s.name?.includes("deno-app-engine") ||
            s.name?.includes("Deno App Engine"),
        );

        if (!this.service) {
          throw new Error(
            `Service ${this.serviceId} not found. Available services: ${services.map((s: any) => s.id).join(", ")}`,
          );
        }

        log.info("[HyphaAgent] Found service in list:", this.service.id);
      }

      this.isConnected = true;
      log.info("[HyphaAgent] Connected successfully");
    } catch (error: any) {
      log.error("[HyphaAgent] Failed to connect:", error);

      // Check if this is an authentication error
      const errorMessage =
        error?.message || error?.toString() || "Unknown error";
      if (
        errorMessage.includes("authentication") ||
        errorMessage.includes("token") ||
        errorMessage.includes("unauthorized")
      ) {
        throw new Error("Authentication failed. Please log in again.");
      }

      throw error;
    }
  }

  async createAgent(config: AgentConfig): Promise<AgentInfo> {
    await this.initialize();

    if (!this.service || !("createAgent" in this.service)) {
      throw new Error("createAgent method not available in service");
    }

    try {
      // Check if agent already exists
      if (this.agentId) {
        try {
          const existingAgents = await this.service.listAgents();
          const existingAgent = existingAgents.find(
            (a: AgentInfo) => a.id === this.agentId,
          );
          if (existingAgent) {
            log.info(
              "[HyphaAgent] Agent already exists, reusing:",
              this.agentId,
            );
            return existingAgent;
          }
        } catch (listError) {
          log.warn("[HyphaAgent] Failed to check existing agents:", listError);
        }
      }

      log.info("[HyphaAgent] Creating new agent:", config.id);
      log.debug("[HyphaAgent] Agent config:", config);

      const agent = await this.service.createAgent(config);
      this.agentId = agent.id;
      log.info("[HyphaAgent] Agent created successfully:", agent.id);
      return agent;
    } catch (error: any) {
      log.error("[HyphaAgent] Failed to create agent:", error);

      // Check if this is a startup script error
      const errorMessage =
        error?.message || error?.toString() || "Unknown error";
      if (
        errorMessage.includes("Startup script failed") ||
        errorMessage.includes("SyntaxError") ||
        errorMessage.includes("unterminated string")
      ) {
        log.error(
          "[HyphaAgent] Startup script error detected. This may be due to script formatting issues.",
        );
        log.error("[HyphaAgent] Startup script content:", config.startupScript);
      }

      throw error;
    }
  }

  async destroyAgent(agentId: string): Promise<void> {
    await this.initialize();

    if (!this.service || !("destroyAgent" in this.service)) {
      throw new Error("destroyAgent method not available in service");
    }

    try {
      await this.service.destroyAgent({ agentId: agentId });
      if (this.agentId === agentId) {
        this.agentId = null;
        this.sessionId = null;
      }
    } catch (error) {
      log.error("[HyphaAgent] Failed to destroy agent:", error);
      throw error;
    }
  }

  async listAgents(): Promise<AgentInfo[]> {
    await this.initialize();

    if (!this.service || !("listAgents" in this.service)) {
      throw new Error("listAgents method not available in service");
    }

    try {
      return await this.service.listAgents();
    } catch (error) {
      log.error("[HyphaAgent] Failed to list agents:", error);
      throw error;
    }
  }

  async chat(options: ChatOptions): Promise<void> {
    if (!this.agentId) {
      options.onError?.(
        new Error("No agent selected. Please create or select an agent first."),
      );
      return;
    }

    await this.initialize();

    if (!this.service || !("chatWithAgent" in this.service)) {
      options.onError?.(
        new Error("chatWithAgent method not available in service"),
      );
      return;
    }

    // Create abort controller for this request
    this.abortController = new AbortController();

    // Generate session ID if not exists
    if (!this.sessionId) {
      this.sessionId = `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }

    // Convert messages to simple format expected by the agent service
    const lastMessage = options.messages[options.messages.length - 1];
    const messageContent =
      typeof lastMessage.content === "string"
        ? lastMessage.content
        : Array.isArray(lastMessage.content)
          ? lastMessage.content
              .map((c) => (c.type === "text" ? c.text : ""))
              .join(" ")
          : "";

    let accumulatedContent = "";
    let stopReason: ChatCompletionFinishReason | undefined;
    let usage: CompletionUsage | undefined;

    try {
      log.info("[HyphaAgent] Starting chat with agent:", this.agentId);

      // Retry logic for agent initialization
      let chatGenerator;
      let retryCount = 0;
      const maxRetries = 3;

      while (retryCount < maxRetries) {
        try {
          log.debug("chatWithAgent", this.agentId, this.sessionId);
          // Chat with agent using async generator
          chatGenerator = await this.service.chatWithAgent({
            agentId: this.agentId,
            message: messageContent,
            sessionId: this.sessionId,
          });
          break; // Success, exit retry loop
        } catch (error: any) {
          retryCount++;
          // Safer error message extraction with proper fallback
          let errorMessage = "Unknown error";
          try {
            if (error?.message && typeof error.message === "string") {
              errorMessage = error.message;
            } else if (error && typeof error.toString === "function") {
              const errorStr = error.toString();
              if (
                errorStr &&
                typeof errorStr === "string" &&
                errorStr !== "[object Object]"
              ) {
                errorMessage = errorStr;
              }
            } else if (typeof error === "string") {
              errorMessage = error;
            }
          } catch (e) {
            // Keep default "Unknown error" if any extraction fails
          }

          log.warn(
            `[HyphaAgent] Chat attempt ${retryCount} failed:`,
            errorMessage,
          );

          if (
            retryCount < maxRetries &&
            (errorMessage.includes("not found") ||
              errorMessage.includes("Agent") ||
              errorMessage.includes("timeout"))
          ) {
            // Wait before retrying (exponential backoff)
            await new Promise((resolve) =>
              setTimeout(resolve, 1000 * retryCount),
            );
            continue;
          } else {
            throw error; // Re-throw if max retries reached or unrecoverable error
          }
        }
      }

      if (!chatGenerator) {
        throw new Error("Failed to create chat generator after retries");
      }

      for await (const chunk of chatGenerator) {
        // Check if aborted
        if (this.abortController?.signal.aborted) {
          break;
        }

        if (chunk.type === "error") {
          options.onError?.(
            new Error(chunk.error || "Unknown error from agent"),
          );
          return;
        } else if (chunk.type === "text_chunk" && chunk.content) {
          accumulatedContent += chunk.content;
          options.onUpdate?.(accumulatedContent, chunk.content);
        } else if (chunk.type === "text" && chunk.content) {
          accumulatedContent = chunk.content;
          options.onUpdate?.(accumulatedContent, chunk.content);
        }
      }

      // Set completion status
      stopReason = this.abortController?.signal.aborted ? "stop" : "stop";
      const promptTokens = options.messages.reduce(
        (acc, msg) =>
          acc + (typeof msg.content === "string" ? msg.content.length : 0),
        0,
      );
      const completionTokens = accumulatedContent.length;

      usage = {
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: promptTokens + completionTokens,
        extra: {
          e2e_latency_s: 0,
          prefill_tokens_per_s: 0,
          decode_tokens_per_s: 0,
          time_to_first_token_s: 0,
          time_per_output_token_s: 0,
        },
      };

      if (accumulatedContent && !this.abortController?.signal.aborted) {
        options.onFinish(accumulatedContent, stopReason, usage);
      }
    } catch (error: any) {
      if (
        error?.name === "AbortError" ||
        this.abortController?.signal.aborted
      ) {
        log.info("[HyphaAgent] Chat aborted by user");
        return;
      }

      log.error("[HyphaAgent] Chat error:", error);
      options.onError?.(error);
    } finally {
      this.abortController = null;
    }
  }

  async abort(): Promise<void> {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  async models() {
    // Return empty array since we're using agents instead of models
    return [];
  }

  // Utility methods
  setAgentId(agentId: string): void {
    this.agentId = agentId;
    this.sessionId = null; // Reset session when changing agents
  }

  getAgentId(): string | null {
    return this.agentId;
  }

  async disconnect(): Promise<void> {
    try {
      // Only disconnect if we created the connection (not using external server)
      if (this.server && "disconnect" in this.server && !this.externalServer) {
        await this.server.disconnect();
      }
    } catch (error) {
      log.error("[HyphaAgent] Error disconnecting:", error);
    }

    // Reset state but don't clear external server
    this.server = this.externalServer || null;
    this.service = null;
    this.isConnected = false;
    this.agentId = null;
    this.sessionId = null;
  }

  // Check if user is authenticated
  isAuthenticated(): boolean {
    return this.getSavedToken() !== null;
  }

  // Set external server connection
  setServer(server: any): void {
    this.externalServer = server;
    this.server = server;
    // Reset connection state to force re-initialization with new server
    if (server) {
      this.isConnected = false;
    }
  }
}
