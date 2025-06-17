"use client";

import log from "loglevel";
import { hyphaWebsocketClient } from "hypha-rpc";
import { ChatOptions, LLMApi, LLMConfig, RequestMessage } from "./api";
import { ChatCompletionFinishReason, CompletionUsage } from "@mlc-ai/web-llm";

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

// Convert script tags to markdown code blocks for better streaming rendering
// This function prevents rendering issues during streaming by converting special HTML-like tags
// to standard markdown before they reach the React markdown renderer
const convertScriptTagsToMarkdown = (content: string): string => {
  let processedContent = content;

  // 1. Convert script tags to markdown code blocks
  const scriptTagMappings: Record<string, string> = {
    "py-script": "python",
    "t-script": "typescript",
    javascript: "javascript",
  };

  for (const [tagName, language] of Object.entries(scriptTagMappings)) {
    // Pattern matches both complete and partial tags (for streaming)
    const scriptTagRegex = new RegExp(
      `<${tagName}[^>]*>([\\s\\S]*?)(?:</${tagName}>|$)`,
      "gi",
    );

    processedContent = processedContent.replace(
      scriptTagRegex,
      (match, codeContent) => {
        const isComplete = match.includes(`</${tagName}>`);

        if (isComplete) {
          return `\`\`\`${language}\n${codeContent.trim()}\n\`\`\``;
        } else {
          // For streaming: create open code block without closing backticks
          return `\`\`\`${language}\n${codeContent}`;
        }
      },
    );
  }

  // 2. Convert thinking/thoughts tags to quoted blocks
  const thoughtTags = ["thoughts", "thinking"];
  for (const tagName of thoughtTags) {
    const thoughtRegex = new RegExp(
      `<${tagName}[^>]*>([\\s\\S]*?)(?:</${tagName}>|$)`,
      "gi",
    );

    processedContent = processedContent.replace(
      thoughtRegex,
      (match, thoughtContent) => {
        const isComplete = match.includes(`</${tagName}>`);
        const emoji = tagName === "thoughts" ? "💭" : "🤔";
        const title = tagName === "thoughts" ? "Thoughts" : "Thinking";

        if (isComplete) {
          return `\n> **${emoji} ${title}**\n> \n> ${thoughtContent.trim().replace(/\n/g, "\n> ")}\n`;
        } else {
          return `\n> **${emoji} ${title}**\n> \n> ${thoughtContent.replace(/\n/g, "\n> ")}`;
        }
      },
    );
  }

  // 3. Convert returnToUser tags to formatted response sections
  const returnToUserRegex =
    /<returnToUser[^>]*>([\s\S]*?)(?:<\/returnToUser>|$)/gi;
  processedContent = processedContent.replace(
    returnToUserRegex,
    (match, returnContent) => {
      const isComplete = match.includes("</returnToUser>");

      if (isComplete) {
        return `\n**📋 Final Response:**\n\n${returnContent.trim()}\n`;
      } else {
        return `\n**📋 Final Response:**\n\n${returnContent}`;
      }
    },
  );

  return processedContent;
};

/**
 * Configuration options for smooth streaming
 */
interface StreamingConfig {
  enabled: boolean;
  baseSpeed: number; // Characters per second
  adaptiveSpeed: boolean;
  smoothness: "low" | "medium" | "high";
  instantMessages: string[]; // Message types to display instantly
}

/**
 * Default streaming configuration
 */
const DEFAULT_STREAMING_CONFIG: StreamingConfig = {
  enabled: true,
  baseSpeed: 35,
  adaptiveSpeed: true,
  smoothness: "high",
  instantMessages: ["function_call", "function_call_output", "error", "system"],
};

/**
 * Advanced streaming utilities for smooth text rendering
 */
class StreamingUtils {
  private static config: StreamingConfig = { ...DEFAULT_STREAMING_CONFIG };

  /**
   * Update streaming configuration
   */
  static configure(config: Partial<StreamingConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get current configuration
   */
  static getConfig(): StreamingConfig {
    return { ...this.config };
  }

  /**
   * Check if streaming is enabled
   */
  static isEnabled(): boolean {
    return this.config.enabled;
  }

  /**
   * Calculate adaptive speed based on content context
   */
  static calculateSpeed(content: string, position: number): number {
    if (!this.config.adaptiveSpeed) {
      return this.config.baseSpeed;
    }

    const remainingContent = content.substring(position);
    const contextBefore = content.substring(
      Math.max(0, position - 50),
      position,
    );

    // Code blocks - slower for readability
    if (this.isInCodeBlock(content, position)) {
      return this.config.baseSpeed * 0.4;
    }

    // Function calls or system messages - faster
    if (remainingContent.match(/^🚀|^✅|^📤|^🔄/)) {
      return this.config.baseSpeed * 1.8;
    }

    // Whitespace - much faster
    if (/^\s+/.test(remainingContent)) {
      return this.config.baseSpeed * 3;
    }

    // Punctuation - slightly faster
    if (/^[.,!?;:]/.test(remainingContent)) {
      return this.config.baseSpeed * 1.5;
    }

    // Markdown formatting - faster
    if (/^[*_`#\-\[\]()]/.test(remainingContent)) {
      return this.config.baseSpeed * 2;
    }

    // Regular text - base speed with slight randomization for naturalness
    const randomFactor = 0.8 + Math.random() * 0.4; // 0.8-1.2 multiplier
    return this.config.baseSpeed * randomFactor;
  }

  /**
   * Check if position is within a code block
   */
  private static isInCodeBlock(content: string, position: number): boolean {
    const beforePosition = content.substring(0, position);
    const codeBlockMatches = beforePosition.match(/```/g);
    return codeBlockMatches ? codeBlockMatches.length % 2 === 1 : false;
  }

  /**
   * Get frame rate based on smoothness setting
   */
  static getFrameInterval(): number {
    switch (this.config.smoothness) {
      case "low":
        return 100; // ~10 FPS
      case "medium":
        return 50; // ~20 FPS
      case "high":
        return 16; // ~60 FPS
      default:
        return 16;
    }
  }
}

/**
 * Enhanced streaming buffer with advanced smoothing and adaptive capabilities
 */
class SmoothStreamingBuffer {
  private targetContent = "";
  private displayedContent = "";
  private isStreaming = false;
  private isCompleted = false;
  private streamingRaf: number | null = null;
  private lastUpdateTime = 0;
  private pendingUpdates: string[] = [];
  private onUpdate: (content: string) => void;
  private generationPattern: "steady" | "burst" | "slow" = "steady";
  private chunkTimings: number[] = [];

  constructor(onUpdate: (content: string) => void) {
    this.onUpdate = onUpdate;
  }

  /**
   * Add content with generation pattern detection
   */
  addContent(newContent: string): void {
    // Skip streaming if disabled
    if (!StreamingUtils.isEnabled()) {
      this.targetContent = newContent;
      this.displayedContent = newContent;
      this.onUpdate(this.displayedContent);
      return;
    }

    this.detectGenerationPattern(newContent);
    this.targetContent = newContent;
    this.isCompleted = false;

    if (!this.isStreaming) {
      this.startSmoothing();
    }
  }

  /**
   * Immediately display content (bypasses streaming)
   */
  addImmediateContent(content: string): void {
    this.stopSmoothing();
    this.targetContent = content;
    this.displayedContent = content;
    this.isCompleted = true;
    this.onUpdate(this.displayedContent);
  }

  /**
   * Replace content and restart streaming
   */
  replaceContent(newContent: string): void {
    this.stopSmoothing();
    this.targetContent = newContent;
    this.displayedContent = "";
    this.isCompleted = false;

    if (StreamingUtils.isEnabled()) {
      this.startSmoothing();
    } else {
      this.displayedContent = newContent;
      this.onUpdate(this.displayedContent);
    }
  }

  /**
   * Complete streaming and show all remaining content
   */
  complete(): void {
    this.isCompleted = true;
    if (this.displayedContent !== this.targetContent) {
      this.displayedContent = this.targetContent;
      this.onUpdate(this.displayedContent);
    }
    this.stopSmoothing();
  }

  /**
   * Stop streaming and reset
   */
  stop(): void {
    this.stopSmoothing();
    this.targetContent = "";
    this.displayedContent = "";
    this.isCompleted = false;
    this.chunkTimings = [];
  }

  /**
   * Detect generation patterns to adapt streaming behavior
   */
  private detectGenerationPattern(newContent: string): void {
    const now = Date.now();
    this.chunkTimings.push(now);

    // Keep only recent timings (last 10 chunks)
    if (this.chunkTimings.length > 10) {
      this.chunkTimings = this.chunkTimings.slice(-10);
    }

    if (this.chunkTimings.length >= 3) {
      const intervals = [];
      for (let i = 1; i < this.chunkTimings.length; i++) {
        intervals.push(this.chunkTimings[i] - this.chunkTimings[i - 1]);
      }

      const avgInterval =
        intervals.reduce((a, b) => a + b, 0) / intervals.length;
      const variance =
        intervals.reduce(
          (sum, interval) => sum + Math.pow(interval - avgInterval, 2),
          0,
        ) / intervals.length;

      // Classify generation pattern
      if (avgInterval < 50) {
        this.generationPattern = "burst";
      } else if (avgInterval > 200) {
        this.generationPattern = "slow";
      } else {
        this.generationPattern = "steady";
      }
    }
  }

  /**
   * Start smooth streaming animation
   */
  private startSmoothing(): void {
    if (this.isStreaming) return;

    this.isStreaming = true;
    this.lastUpdateTime = performance.now();

    const smoothFrame = (currentTime: number) => {
      if (!this.isStreaming || this.isCompleted) {
        this.stopSmoothing();
        return;
      }

      const deltaTime = (currentTime - this.lastUpdateTime) / 1000;
      this.lastUpdateTime = currentTime;

      if (this.displayedContent.length < this.targetContent.length) {
        // Calculate characters to add based on adaptive speed
        const currentSpeed = this.getAdaptiveSpeed();
        let charactersToAdd = Math.max(1, Math.floor(currentSpeed * deltaTime));

        // Adjust for generation pattern
        charactersToAdd = this.adjustForGenerationPattern(charactersToAdd);

        const nextLength = Math.min(
          this.displayedContent.length + charactersToAdd,
          this.targetContent.length,
        );

        this.displayedContent = this.targetContent.substring(0, nextLength);
        this.onUpdate(this.displayedContent);

        // Continue animation
        this.streamingRaf = requestAnimationFrame(smoothFrame);
      } else {
        this.isStreaming = false;
      }
    };

    this.streamingRaf = requestAnimationFrame(smoothFrame);
  }

  /**
   * Stop streaming animation
   */
  private stopSmoothing(): void {
    this.isStreaming = false;
    if (this.streamingRaf) {
      cancelAnimationFrame(this.streamingRaf);
      this.streamingRaf = null;
    }
  }

  /**
   * Get adaptive speed based on content and context
   */
  private getAdaptiveSpeed(): number {
    const position = this.displayedContent.length;
    return StreamingUtils.calculateSpeed(this.targetContent, position);
  }

  /**
   * Adjust characters per frame based on detected generation pattern
   */
  private adjustForGenerationPattern(baseChars: number): number {
    switch (this.generationPattern) {
      case "burst":
        // Slower display to smooth out bursts
        return Math.max(1, Math.floor(baseChars * 0.7));
      case "slow":
        // Faster display to maintain engagement
        return Math.floor(baseChars * 1.3);
      case "steady":
      default:
        return baseChars;
    }
  }

  /**
   * Check if currently streaming
   */
  isCurrentlyStreaming(): boolean {
    return this.isStreaming;
  }

  /**
   * Get current displayed content
   */
  getCurrentContent(): string {
    return this.displayedContent;
  }
}

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
    | "function_call_output"
    | "new_completion";
  content?: string;
  error?: string;
  name?: string;
  arguments?: any;
  call_id?: string;
  completion_id?: string;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content?: string;
  tool_call_id?: string;
  tool_calls?: {
    type: string;
    name: string;
    function: any;
    id: string;
  }[];
}

export class HyphaAgentApi implements LLMApi {
  private server: any = null;
  private service: any = null;
  private agentId: string | null = null;
  private abortController: AbortController | null = null;
  private isConnected: boolean = false;

  constructor(
    private serverUrl: string = "https://hypha.aicell.io",
    private serviceId: string = "hypha-agents/deno-app-engine",
    private getServerConnection?: () => Promise<any>,
  ) {}

  /**
   * Configure smooth streaming behavior
   * @param config Partial streaming configuration
   * @example
   * // Disable streaming for testing
   * hyphaAgent.configureStreaming({ enabled: false });
   *
   * // Adjust speed and smoothness
   * hyphaAgent.configureStreaming({
   *   baseSpeed: 50,
   *   smoothness: 'high',
   *   adaptiveSpeed: true
   * });
   */
  configureStreaming(config: Partial<StreamingConfig>): void {
    StreamingUtils.configure(config);
    log.info(
      "[HyphaAgent] Streaming configuration updated:",
      StreamingUtils.getConfig(),
    );
  }

  /**
   * Get current streaming configuration
   */
  getStreamingConfig(): StreamingConfig {
    return StreamingUtils.getConfig();
  }

  /**
   * Enable or disable smooth streaming
   */
  setStreamingEnabled(enabled: boolean): void {
    this.configureStreaming({ enabled });
  }

  /**
   * Determine if content should be displayed immediately or streamed
   */
  private shouldUseImmediateDisplay(
    chunkType: string,
    content?: string,
  ): boolean {
    const config = StreamingUtils.getConfig();

    // Always immediate for instant message types
    if (config.instantMessages.includes(chunkType)) {
      return true;
    }

    // Immediate for system indicators
    if (
      content &&
      (content.includes("🚀 **Executing") ||
        content.includes("✅ **Execution completed") ||
        content.includes("📤 Function output") ||
        content.includes("🔄 New completion"))
    ) {
      return true;
    }

    return false;
  }

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
      // Use server connection provider if available, otherwise create new connection
      if (this.getServerConnection) {
        log.info("[HyphaAgent] Using server connection provider...");

        try {
          this.server = await this.getServerConnection();
          log.info(
            "[HyphaAgent] Server connection obtained:",
            typeof this.server,
          );
        } catch (error) {
          log.error("[HyphaAgent] Failed to get server connection:", error);
          throw error;
        }

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
        log.info(
          "[HyphaAgent] No server connection provider, creating new connection...",
        );
        log.info(
          "[HyphaAgent] Note: This will create a separate connection which may cause performance overhead",
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
      if (isAuthenticationError(error)) {
        // Clear local storage to ensure consistency
        if (typeof window !== "undefined") {
          localStorage.removeItem("token");
          localStorage.removeItem("tokenExpiry");
          localStorage.removeItem("user");
        }

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
      // Check if agent already exists - match the full agent ID from config
      try {
        const agentExistsResult = await this.service.agentExists({
          agentId: config.id,
        });
        if (agentExistsResult.exists) {
          log.info(
            "[HyphaAgent] Found existing agent, but destroying it to ensure clean state:",
            config.id,
          );
          // Always destroy existing agent to avoid reusing potentially broken agents
          try {
            await this.service.destroyAgent({ agentId: config.id });
            log.info("[HyphaAgent] Existing agent destroyed successfully");
          } catch (destroyError) {
            log.warn(
              "[HyphaAgent] Failed to destroy existing agent:",
              destroyError,
            );
            // Continue with creation anyway
          }
        }
      } catch (existsError) {
        log.warn("[HyphaAgent] Failed to check if agent exists:", existsError);
        // Don't throw here - continue with creation attempt
      }

      log.info("[HyphaAgent] Creating new agent:", config.id);
      log.debug("[HyphaAgent] Agent config:", config);

      const agent = await this.service.createAgent(config);
      this.agentId = agent.id;
      log.info("[HyphaAgent] Agent created successfully:", agent.id);

      // Wait a moment for the agent to fully initialize and check for startup errors
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Verify the agent is actually working by listing agents again
      try {
        const verifyAgents = await this.service.listAgents();
        const createdAgent = verifyAgents.find(
          (a: AgentInfo) => a.id === agent.id,
        );
        if (!createdAgent) {
          throw new Error(
            "Agent was created but disappeared immediately, indicating a startup failure",
          );
        }
        log.info("[HyphaAgent] Agent verified and working:", agent.id);
      } catch (verifyError) {
        log.error("[HyphaAgent] Agent verification failed:", verifyError);
        // If verification fails, the agent might have startup issues
        throw new Error(
          `Agent created but failed verification: ${verifyError}`,
        );
      }

      return agent;
    } catch (error: any) {
      // Enhanced error logging and processing
      let errorMessage = "Unknown error";
      let errorDetails = "";

      try {
        if (error && typeof error === "object") {
          if ("message" in error && typeof error.message === "string") {
            errorMessage = error.message;
          } else if ("error" in error && typeof error.error === "string") {
            errorMessage = error.error;
          }

          // Try to extract additional details
          if ("details" in error) {
            errorDetails = JSON.stringify(error.details);
          } else if ("stack" in error) {
            errorDetails = error.stack;
          }
        } else if (typeof error === "string") {
          errorMessage = error;
        }
      } catch (parseError) {
        log.warn("[HyphaAgent] Error parsing error object:", parseError);
      }

      // Log detailed error information
      log.error("[HyphaAgent] Failed to create agent:", {
        message: errorMessage,
        details: errorDetails,
        configId: config.id,
        originalError: error,
      });

      // Create a more informative error for the UI
      let uiErrorMessage = errorMessage;

      // Categorize common error patterns
      if (
        errorMessage.toLowerCase().includes("service not found") ||
        (errorMessage.toLowerCase().includes("service") &&
          errorMessage.toLowerCase().includes("not available"))
      ) {
        uiErrorMessage =
          "Agent service is not available. The backend service may be down or not properly configured.";
      } else if (errorMessage.toLowerCase().includes("timeout")) {
        uiErrorMessage =
          "Request timed out. The agent service may be overloaded or experiencing issues.";
      } else if (
        errorMessage.toLowerCase().includes("permission") ||
        errorMessage.toLowerCase().includes("unauthorized") ||
        errorMessage.toLowerCase().includes("forbidden")
      ) {
        uiErrorMessage =
          "Permission denied. You may not have access to create agents with this configuration.";
      } else if (
        errorMessage.toLowerCase().includes("invalid") &&
        errorMessage.toLowerCase().includes("config")
      ) {
        uiErrorMessage =
          "Invalid agent configuration. Please try selecting a different agent.";
      } else if (
        errorMessage.toLowerCase().includes("quota") ||
        errorMessage.toLowerCase().includes("limit")
      ) {
        uiErrorMessage =
          "Resource limit reached. Please try again later or contact support.";
      } else if (
        errorMessage.toLowerCase().includes("network") ||
        errorMessage.toLowerCase().includes("connection")
      ) {
        uiErrorMessage =
          "Network connection issue. Please check your internet connection and try again.";
      }

      // Throw the processed error
      const processedError = new Error(uiErrorMessage);
      processedError.name = "AgentCreationError";
      throw processedError;
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

  async agentExists(params: { agentId: string }): Promise<{ exists: boolean }> {
    await this.initialize();

    if (!this.service || !("agentExists" in this.service)) {
      throw new Error("agentExists method not available in service");
    }

    try {
      return await this.service.agentExists(params);
    } catch (error) {
      log.error("[HyphaAgent] Failed to check if agent exists:", error);
      throw error;
    }
  }

  /**
   * Convert RequestMessage array to ChatMessage array for stateless chat
   */
  private convertToChatMessages(messages: RequestMessage[]): ChatMessage[] {
    return messages.map((msg) => ({
      role: msg.role as "system" | "user" | "assistant",
      content:
        typeof msg.content === "string"
          ? msg.content
          : Array.isArray(msg.content)
            ? msg.content
                .map((c) => (c.type === "text" ? c.text : ""))
                .join(" ")
            : "",
    }));
  }

  async chat(options: ChatOptions): Promise<void> {
    if (!this.agentId) {
      options.onError?.(
        new Error("No agent selected. Please create or select an agent first."),
      );
      return;
    }

    await this.initialize();

    if (!this.service || !("chatWithAgentStateless" in this.service)) {
      options.onError?.(
        new Error("chatWithAgentStateless method not available in service"),
      );
      return;
    }

    // Create abort controller for this request
    this.abortController = new AbortController();

    /*
     * SMOOTH STREAMING IMPLEMENTATION:
     *
     * This chat method implements smooth character-by-character streaming using
     * a StreamingBuffer class. The buffer accumulates chunks as they arrive from
     * the network and uses requestAnimationFrame to smoothly reveal characters
     * at a consistent rate, creating a typewriter effect.
     *
     * Key features:
     * - Adaptive streaming speed based on content type
     * - Immediate display for function calls and system messages
     * - Proper handling of markdown conversion during streaming
     * - Smooth experience even on slow/choppy network connections
     */

    // Convert messages to ChatMessage format for stateless chat
    const chatMessages = this.convertToChatMessages(options.messages);

    let accumulatedContent = "";
    let stopReason: ChatCompletionFinishReason | undefined;
    let usage: CompletionUsage | undefined;

    // Track function executions for detailed summary
    const functionExecutions: Array<{
      name: string;
      args: any;
      callId: string;
      output?: string;
      timestamp: number;
    }> = [];

    // Create streaming buffer for smooth character-by-character rendering
    const streamingBuffer = new SmoothStreamingBuffer((content: string) => {
      // Call the original onUpdate with the processed content
      options.onUpdate?.(content, "");
    });

    try {
      log.info(
        "[HyphaAgent] Starting stateless chat with agent:",
        this.agentId,
        chatMessages,
      );

      // Retry logic for agent initialization
      let chatGenerator;
      let retryCount = 0;
      const maxRetries = 3;

      while (retryCount < maxRetries) {
        try {
          log.debug(
            "chatWithAgentStateless",
            this.agentId,
            chatMessages.length,
            "messages",
          );
          // Chat with agent using async generator - stateless mode
          chatGenerator = await this.service.chatWithAgentStateless({
            agentId: this.agentId,
            messages: chatMessages,
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
          streamingBuffer.stop();
          break;
        }

        if (chunk.type === "error") {
          streamingBuffer.stop();
          options.onError?.(
            new Error(chunk.error || "Unknown error from agent"),
          );
          return;
        } else if (chunk.type === "text_chunk" && chunk.content) {
          // Check if this chunk contains the <returnToUser> tag
          const returnToUserTagRegex = /<returnToUser>/i;
          const chunkContent = chunk.content;

          if (returnToUserTagRegex.test(accumulatedContent + chunkContent)) {
            // If the <returnToUser> tag is detected in the accumulated content or this chunk,
            // clear all previous content and start fresh from the tag
            const fullContent = accumulatedContent + chunkContent;
            const tagMatch = fullContent.match(returnToUserTagRegex);

            if (tagMatch) {
              // Find the position of the tag and get content from that point
              const tagPosition = tagMatch.index || 0;
              const contentFromTag = fullContent.substring(tagPosition);

              // Convert script tags BEFORE updating accumulated content to prevent any flicker
              const processedContentFromTag =
                convertScriptTagsToMarkdown(contentFromTag);

              // Clear accumulated content and start fresh with processed content from the tag
              accumulatedContent = contentFromTag;
              // Use streaming buffer to smoothly display the content from the tag
              streamingBuffer.replaceContent(processedContentFromTag);
            } else {
              // Fallback: just add the chunk normally
              accumulatedContent += chunkContent;
              const processedContent =
                convertScriptTagsToMarkdown(accumulatedContent);
              streamingBuffer.addContent(processedContent);
            }
          } else {
            // Normal chunk processing
            accumulatedContent += chunkContent;
            const processedContent =
              convertScriptTagsToMarkdown(accumulatedContent);
            streamingBuffer.addContent(processedContent);
          }
        } else if (chunk.type === "text" && chunk.content) {
          // For full text updates, also check for returnToUser tag
          const returnToUserTagRegex = /<returnToUser>/i;
          const textContent = chunk.content;

          if (returnToUserTagRegex.test(textContent)) {
            // If the <returnToUser> tag is in the full text, extract content from the tag onward
            const tagMatch = textContent.match(returnToUserTagRegex);

            if (tagMatch) {
              const tagPosition = tagMatch.index || 0;
              const contentFromTag = textContent.substring(tagPosition);

              // Convert script tags BEFORE updating accumulated content to prevent any flicker
              const processedContentFromTag =
                convertScriptTagsToMarkdown(contentFromTag);

              // Replace accumulated content with content from the tag
              accumulatedContent = contentFromTag;
              log.info(
                "[HyphaAgent] <returnToUser> tag detected in full text, clearing previous content",
              );

              // Use streaming buffer to smoothly display the content from the tag
              streamingBuffer.replaceContent(processedContentFromTag);
            } else {
              // Fallback: use the full content
              accumulatedContent = textContent;
              const processedContent =
                convertScriptTagsToMarkdown(accumulatedContent);
              streamingBuffer.addContent(processedContent);
            }
          } else {
            // Normal full text processing
            accumulatedContent = textContent;
            const processedContent =
              convertScriptTagsToMarkdown(accumulatedContent);
            streamingBuffer.addContent(processedContent);
          }
        } else if (chunk.type === "function_call") {
          // Code execution is starting
          const functionName = chunk.name || "unknown_function";
          const callId = chunk.call_id || `call_${Date.now()}`;

          // Add emoji-enhanced function call to accumulated content with spinner
          const executionMessage = `\n\n🚀 **Executing ${functionName} tool** <span class="execution-spinner">🔄</span>\n`;
          accumulatedContent += executionMessage;

          // Convert script tags to markdown before updating
          const processedContent =
            convertScriptTagsToMarkdown(accumulatedContent);

          // Use immediate display for function calls
          if (this.shouldUseImmediateDisplay(chunk.type, processedContent)) {
            streamingBuffer.addImmediateContent(processedContent);
          } else {
            streamingBuffer.addContent(processedContent);
          }

          // Track function execution
          functionExecutions.push({
            name: functionName,
            args: chunk.arguments,
            callId: callId,
            timestamp: Date.now(),
          });

          // Call the callback if provided
          options.onFunctionCall?.(chunk.name, chunk.arguments, chunk.call_id);

          console.log(
            `🚀 Executing ${chunk.name} tool with call_id: ${chunk.call_id}`,
          );
        } else if (chunk.type === "function_call_output") {
          // Code execution completed with results
          const callId = chunk.call_id || "";
          const output = chunk.content || "";

          // Find the corresponding function execution
          const execution = functionExecutions.find(
            (exec) => exec.callId === callId,
          );
          if (execution) {
            execution.output = output;
          }

          // Replace the spinner with completion status in the accumulated content
          // Find and replace the execution message for this specific function call
          const functionNameEscaped = (execution?.name || "function").replace(
            /[.*+?^${}()|[\]\\]/g,
            "\\$&",
          );
          const executionPattern = new RegExp(
            `🚀 \\*\\*Executing ${functionNameEscaped} tool\\*\\* <span class="execution-spinner">🔄</span>`,
            "g",
          );

          // Replace the spinner with completed status
          accumulatedContent = accumulatedContent.replace(
            executionPattern,
            `🚀 **Executing ${execution?.name || "function"} tool** ✅`,
          );

          // Format and display the results
          let resultMessage = `\n✅ **Execution completed**\n\n`;

          if (output) {
            resultMessage += `**Result:**\n\n`;

            // Try to format output as JSON if possible
            try {
              const parsedOutput = JSON.parse(output);
              resultMessage += "```json\n";
              resultMessage += JSON.stringify(parsedOutput, null, 2);
              resultMessage += "\n```\n\n";
            } catch {
              // If not JSON, check if it looks like console output or plain text
              if (output.includes("\n") || output.length > 100) {
                // Multi-line or long output - use code block
                resultMessage += "```\n";
                resultMessage += output;
                resultMessage += "\n```\n\n";
              } else {
                // Short output - display inline with code formatting
                resultMessage += `\`${output}\`\n\n`;
              }
            }
          }

          accumulatedContent += resultMessage;

          // Convert script tags to markdown before updating
          const processedContent =
            convertScriptTagsToMarkdown(accumulatedContent);

          // Use immediate display for function output
          if (this.shouldUseImmediateDisplay(chunk.type, processedContent)) {
            streamingBuffer.addImmediateContent(processedContent);
          } else {
            streamingBuffer.addContent(processedContent);
          }

          // Call the callback if provided
          options.onFunctionOutput?.(chunk.content, chunk.call_id);

          console.log(
            `📤 Function output for ${chunk.call_id}:`,
            chunk.content,
          );
        } else if (chunk.type === "new_completion") {
          // New completion round starting - handle as streaming content
          const processedContent =
            convertScriptTagsToMarkdown(accumulatedContent);
          streamingBuffer.addContent(processedContent);

          // Call the callback if provided
          options.onNewCompletion?.(chunk.completion_id);

          console.log(`🔄 New completion started: ${chunk.completion_id}`);
        }
      }

      // Set completion status
      stopReason = this.abortController?.signal.aborted ? "stop" : "stop";
      const promptTokens = options.messages.reduce(
        (acc, msg) =>
          acc + (typeof msg.content === "string" ? msg.content.length : 0),
        0,
      );

      // Add function execution summary if there were any function calls
      let finalContent = accumulatedContent;
      if (functionExecutions.length > 0) {
        const executionSummary =
          this.formatFunctionExecutionSummary(functionExecutions);
        // Ensure the execution summary also has script tags converted
        const processedSummary = convertScriptTagsToMarkdown(executionSummary);
        finalContent += processedSummary;
      }

      // Convert script tags to markdown for final content
      const processedFinalContent = convertScriptTagsToMarkdown(finalContent);
      const completionTokens = processedFinalContent.length;

      // Complete the streaming buffer to ensure all content is displayed
      if (functionExecutions.length > 0) {
        // If we have function executions, add the summary to the streaming buffer
        streamingBuffer.addContent(processedFinalContent);
      }

      // Complete the streaming to show any remaining content immediately
      streamingBuffer.complete();

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

      // Always call onFinish with the final processed content
      if (processedFinalContent && !this.abortController?.signal.aborted) {
        options.onFinish(processedFinalContent, stopReason, usage);
      }
    } catch (error: any) {
      // Always stop streaming buffer on error
      streamingBuffer.stop();

      if (
        error?.name === "AbortError" ||
        this.abortController?.signal.aborted
      ) {
        log.info("[HyphaAgent] Chat aborted by user");
        return;
      }

      // Check for authentication errors
      if (isAuthenticationError(error)) {
        // Clear local storage on authentication failure
        if (typeof window !== "undefined") {
          localStorage.removeItem("token");
          localStorage.removeItem("tokenExpiry");
          localStorage.removeItem("user");
        }

        log.error("[HyphaAgent] Authentication error during chat:", error);
        options.onError?.(
          new Error("Authentication failed. Please log in again."),
        );
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
  }

  getAgentId(): string | null {
    return this.agentId;
  }

  async disconnect(): Promise<void> {
    try {
      // Only disconnect if we created the connection (not using server connection provider)
      if (
        this.server &&
        "disconnect" in this.server &&
        !this.getServerConnection
      ) {
        await this.server.disconnect();
      }
    } catch (error) {
      log.error("[HyphaAgent] Error disconnecting:", error);
    }

    // Reset state
    this.server = null;
    this.service = null;
    this.isConnected = false;
    this.agentId = null;
  }

  // Check if user is authenticated
  isAuthenticated(): boolean {
    return this.getSavedToken() !== null;
  }

  // Set server connection provider
  setServerConnectionProvider(getServerConnection: () => Promise<any>): void {
    this.getServerConnection = getServerConnection;
    // Reset connection state to force re-initialization with new provider
    this.server = null;
    this.isConnected = false;
  }

  // Format function execution summary as collapsible markdown with proper spacing
  private formatFunctionExecutionSummary(
    executions: Array<{
      name: string;
      args: any;
      callId: string;
      output?: string;
      timestamp: number;
    }>,
  ): string {
    if (executions.length === 0) return "";

    let summary = "";
    summary += `<details>\n\n<summary>🔧 Tool Use History (${executions.length} ${executions.length === 1 ? "tool call" : "tool calls"})</summary>\n\n`;

    executions.forEach((execution, index) => {
      const duration = execution.output ? "✅ completed" : "⏳ in progress";
      const timestamp = new Date(execution.timestamp).toLocaleTimeString();

      summary += `### ${index + 1}. \`${execution.name}\` Tool\n\n`;
      // summary += `- **Call ID:** \`${execution.callId}\`\n`;
      // summary += `- **Time:** ${timestamp}\n`;
      // summary += `- **Status:** ${duration}\n\n`;

      if (execution.args && Object.keys(execution.args).length > 0) {
        // Special handling for runCode function
        if (execution.name === "runCode" && execution.args.code) {
          summary += `**Code:**\n\n`;

          // Detect language from context or default to python
          const language =
            execution.args.language ||
            (execution.args.kernel === "typescript"
              ? "typescript"
              : execution.args.kernel === "javascript"
                ? "javascript"
                : "python");

          summary += `\`\`\`${language}\n`;
          summary += execution.args.code;
          summary += "\n```\n\n";

          // Show other arguments if any (excluding code)
          const otherArgs = { ...execution.args };
          delete otherArgs.code;

          if (Object.keys(otherArgs).length > 0) {
            summary += `**Other Arguments:**\n\n`;
            summary += "```json\n";
            summary += JSON.stringify(otherArgs, null, 2);
            summary += "\n```\n\n";
          }
        } else {
          // Default handling for other functions
          summary += `**Arguments:**\n\n`;
          summary += "```json\n";
          summary += JSON.stringify(execution.args, null, 2);
          summary += "\n```\n\n";
        }
      }

      if (execution.output) {
        if (execution.name === "runCode") {
          summary += `**Result:**\n\n`;
          // For runCode, try to format output as JSON if possible
          try {
            const parsedOutput = JSON.parse(execution.output);
            summary += "```json\n";
            summary += JSON.stringify(parsedOutput, null, 2);
            summary += "\n```\n\n";
          } catch {
            // If not JSON, check if it looks like console output or plain text
            if (
              execution.output.includes("\n") ||
              execution.output.length > 100
            ) {
              // Multi-line or long output - use code block
              summary += "```\n";
              summary += execution.output;
              summary += "\n```\n\n";
            } else {
              // Short output - display inline
              summary += `\`${execution.output}\`\n\n`;
            }
          }
        } else {
          // Default handling for other functions
          summary += `**Output:**\n\n`;
          // Try to detect if output is JSON and format it nicely
          try {
            const parsedOutput = JSON.parse(execution.output);
            summary += "```json\n";
            summary += JSON.stringify(parsedOutput, null, 2);
            summary += "\n```\n\n";
          } catch {
            // If not JSON, display as plain text with code formatting
            summary += "```\n";
            summary += execution.output;
            summary += "\n```\n\n";
          }
        }
      }

      if (index < executions.length - 1) {
        summary += "---\n\n";
      }
    });

    summary += "\n</details>\n\n";
    return summary;
  }
}
