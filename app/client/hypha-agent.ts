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
    private getServerConnection?: () => Promise<any>,
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
        const existingAgents = await this.service.listAgents();
        const existingAgent = existingAgents.find((a: AgentInfo) => {
          // Extract the agent part after the colon (e.g., "MZazLDPeIBxktE6fcgpRc@productive-martin-touch-upliftingly")
          const agentPart = a.id.includes(":") ? a.id.split(":").pop() : a.id;
          // Match the full agent ID from config
          return agentPart === config.id;
        });
        if (existingAgent) {
          log.info(
            "[HyphaAgent] Found existing agent, but destroying it to ensure clean state:",
            existingAgent.id,
          );
          // Always destroy existing agent to avoid reusing potentially broken agents
          try {
            await this.service.destroyAgent({ agentId: existingAgent.id });
            log.info("[HyphaAgent] Existing agent destroyed successfully");
          } catch (destroyError) {
            log.warn(
              "[HyphaAgent] Failed to destroy existing agent:",
              destroyError,
            );
            // Continue with creation anyway
          }
        }
      } catch (listError) {
        log.warn("[HyphaAgent] Failed to check existing agents:", listError);
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

    // Track function executions for detailed summary
    const functionExecutions: Array<{
      name: string;
      args: any;
      callId: string;
      output?: string;
      timestamp: number;
    }> = [];

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

              // Clear accumulated content and start fresh with content from the tag
              accumulatedContent = contentFromTag;
              log.info(
                "[HyphaAgent] <returnToUser> tag detected, clearing previous content",
              );

              // Update with the cleared content
              options.onUpdate?.(accumulatedContent, accumulatedContent);
            } else {
              // Fallback: just add the chunk normally
              accumulatedContent += chunkContent;
              options.onUpdate?.(accumulatedContent, chunkContent);
            }
          } else {
            // Normal chunk processing
            accumulatedContent += chunkContent;
            options.onUpdate?.(accumulatedContent, chunkContent);
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

              // Replace accumulated content with content from the tag
              accumulatedContent = contentFromTag;
              log.info(
                "[HyphaAgent] <returnToUser> tag detected in full text, clearing previous content",
              );

              options.onUpdate?.(accumulatedContent, accumulatedContent);
            } else {
              // Fallback: use the full content
              accumulatedContent = textContent;
              options.onUpdate?.(accumulatedContent, textContent);
            }
          } else {
            // Normal full text processing
            accumulatedContent = textContent;
            options.onUpdate?.(accumulatedContent, textContent);
          }
        } else if (chunk.type === "function_call") {
          // Code execution is starting
          const functionName = chunk.name || "unknown_function";
          const callId = chunk.call_id || `call_${Date.now()}`;

          // Close any unclosed script tags before adding execution message
          accumulatedContent =
            this.closeUnfinishedScriptTags(accumulatedContent);

          // Add emoji-enhanced function call to accumulated content
          const executionMessage = `\n\n🚀 **Executing ${functionName}**\n`;
          accumulatedContent += executionMessage;
          options.onUpdate?.(accumulatedContent, executionMessage);

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
            `🚀 Executing ${chunk.name} with call_id: ${chunk.call_id}`,
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

          // Format and display the results immediately
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
          options.onUpdate?.(accumulatedContent, resultMessage);

          // Call the callback if provided
          options.onFunctionOutput?.(chunk.content, chunk.call_id);

          console.log(
            `📤 Function output for ${chunk.call_id}:`,
            chunk.content,
          );
        } else if (chunk.type === "new_completion") {
          // New completion round starting
          options.onUpdate?.(accumulatedContent, "🤔 Thinking...");

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
        finalContent += executionSummary;
      }

      const completionTokens = finalContent.length;

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

      if (finalContent && !this.abortController?.signal.aborted) {
        options.onFinish(finalContent, stopReason, usage);
      }
    } catch (error: any) {
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
    this.sessionId = null; // Reset session when changing agents
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
    this.sessionId = null;
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

  // Close any unfinished script tags in content during streaming
  private closeUnfinishedScriptTags(content: string): string {
    // List of script tags we need to check for
    const scriptTags = [
      "py-script",
      "t-script",
      "javascript",
      "thoughts",
      "thinking",
    ];

    let processedContent = content;

    // Check each script tag type
    for (const tag of scriptTags) {
      // Find all opening tags
      const openTagRegex = new RegExp(`<${tag}[^>]*>`, "gi");
      const closeTagRegex = new RegExp(`</${tag}>`, "gi");

      const openMatches = content.match(openTagRegex) || [];
      const closeMatches = content.match(closeTagRegex) || [];

      // If we have more opening tags than closing tags, we need to close them
      const unclosedCount = openMatches.length - closeMatches.length;

      if (unclosedCount > 0) {
        // Add the missing closing tags at the end
        for (let i = 0; i < unclosedCount; i++) {
          processedContent += `</${tag}>`;
        }
      }
    }

    return processedContent;
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
    summary += `<details>\n\n<summary>🔧 Function Executions (${executions.length} ${executions.length === 1 ? "call" : "calls"})</summary>\n\n`;

    executions.forEach((execution, index) => {
      const duration = execution.output ? "✅ completed" : "⏳ in progress";
      const timestamp = new Date(execution.timestamp).toLocaleTimeString();

      summary += `### ${index + 1}. \`${execution.name}\`\n\n`;
      summary += `- **Call ID:** \`${execution.callId}\`\n`;
      summary += `- **Time:** ${timestamp}\n`;
      summary += `- **Status:** ${duration}\n\n`;

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
