"use client";

require("../polyfill");

import styles from "./home.module.scss";

import log from "loglevel";
import dynamic from "next/dynamic";
import { useState, useEffect, useRef, useCallback } from "react";
import {
  HashRouter as Router,
  Routes,
  Route,
  useLocation,
} from "react-router-dom";
import { ServiceWorkerMLCEngine } from "@mlc-ai/web-llm";

import MlcIcon from "../icons/mlc.svg";
import LoadingIcon from "../icons/three-dots.svg";

import Locale from "../locales";
import { getCSSVar, useMobileScreen } from "../utils";
import { DEFAULT_MODELS, Path, SlotID } from "../constant";
import { ErrorBoundary } from "./error";
import { getISOLang, getLang } from "../locales";
import { SideBar } from "./sidebar";
import { useAppConfig } from "../store/config";
import { WebLLMApi } from "../client/webllm";
import { ModelClient, useChatStore } from "../store";
import { MLCLLMContext, WebLLMContext, HyphaAgentContext } from "../context";
import { MlcLLMApi } from "../client/mlcllm";
import { HyphaAgentApi } from "../client/hypha-agent";
import { useHyphaStore } from "../store/hypha";

export function Loading(props: { noLogo?: boolean }) {
  return (
    <div className={styles["loading-content"] + " no-dark"}>
      {!props.noLogo && (
        <div className={styles["loading-content-logo"] + " no-dark"}>
          <img
            src="/logo.png"
            alt="Research Navigator"
            style={{ width: "100%", height: "100%", objectFit: "contain" }}
          />
        </div>
      )}
      <LoadingIcon />
    </div>
  );
}

export function ErrorScreen(props: { message: string }) {
  return (
    <div className={styles["error-screen"] + " no-dark"}>
      <p>{props.message}</p>
    </div>
  );
}

const Settings = dynamic(async () => (await import("./settings")).Settings, {
  loading: () => <Loading noLogo />,
});

const Chat = dynamic(async () => (await import("./chat")).Chat, {
  loading: () => <Loading noLogo />,
});

const TemplatePage = dynamic(
  async () => (await import("./template")).TemplatePage,
  {
    loading: () => <Loading noLogo />,
  },
);

export function useSwitchTheme() {
  const config = useAppConfig();

  useEffect(() => {
    document.body.classList.remove("light");
    document.body.classList.remove("dark");

    if (config.theme === "dark") {
      document.body.classList.add("dark");
    } else if (config.theme === "light") {
      document.body.classList.add("light");
    }

    const metaDescriptionDark = document.querySelector(
      'meta[name="theme-color"][media*="dark"]',
    );
    const metaDescriptionLight = document.querySelector(
      'meta[name="theme-color"][media*="light"]',
    );

    if (config.theme === "auto") {
      metaDescriptionDark?.setAttribute("content", "#151515");
      metaDescriptionLight?.setAttribute("content", "#fafafa");
    } else {
      const themeColor = getCSSVar("--theme-color");
      metaDescriptionDark?.setAttribute("content", themeColor);
      metaDescriptionLight?.setAttribute("content", themeColor);
    }
  }, [config.theme]);
}

function useHtmlLang() {
  useEffect(() => {
    const lang = getISOLang();
    const htmlLang = document.documentElement.lang;

    if (lang !== htmlLang) {
      document.documentElement.lang = lang;
    }
  }, []);
}

const useHasHydrated = () => {
  const [hasHydrated, setHasHydrated] = useState<boolean>(false);

  useEffect(() => {
    setHasHydrated(true);
  }, []);

  return hasHydrated;
};

const loadAsyncFonts = () => {
  const linkEl = document.createElement("link");
  linkEl.rel = "stylesheet";
  linkEl.href = "/fonts/font.css";
  document.head.appendChild(linkEl);
};

function Screen() {
  const config = useAppConfig();
  const location = useLocation();
  const isHome = location.pathname === Path.Home;
  const isMobileScreen = useMobileScreen();
  const shouldTightBorder = config.tightBorder && !isMobileScreen;

  useEffect(() => {
    loadAsyncFonts();
  }, []);

  return (
    <div
      className={
        styles.container +
        ` ${shouldTightBorder ? styles["tight-container"] : styles.container} ${
          getLang() === "ar" ? styles["rtl-screen"] : ""
        }`
      }
    >
      <>
        <SideBar className={isHome ? styles["sidebar-show"] : ""} />

        <div className={styles["window-content"]} id={SlotID.AppBody}>
          <Routes>
            <Route path={Path.Home} element={<Chat />} />
            <Route path={Path.Templates} element={<TemplatePage />} />
            <Route path={Path.Chat} element={<Chat />} />
            <Route path={Path.Settings} element={<Settings />} />
          </Routes>
        </div>
      </>
    </div>
  );
}

const useWebLLM = () => {
  const config = useAppConfig();
  const [webllm, setWebLLM] = useState<WebLLMApi | undefined>(undefined);
  const [isWebllmActive, setWebllmAlive] = useState(false);

  const isWebllmInitialized = useRef(false);

  // If service worker registration timeout, fall back to web worker
  const timeout = setTimeout(() => {
    if (!isWebllmInitialized.current && !isWebllmActive && !webllm) {
      log.info(
        "Service Worker activation is timed out. Falling back to use web worker.",
      );
      setWebLLM(new WebLLMApi("webWorker", config.logLevel));
      setWebllmAlive(true);
    }
  }, 2_000);

  // Initialize WebLLM engine
  useEffect(() => {
    // Prevent duplicate initialization
    if (isWebllmInitialized.current || webllm || isWebllmActive) {
      return;
    }

    if ("serviceWorker" in navigator) {
      log.info("Service Worker API is available and in use.");
      navigator.serviceWorker.ready.then(() => {
        // Double-check before proceeding
        if (isWebllmInitialized.current || webllm || isWebllmActive) {
          return;
        }

        log.info("Service Worker is activated.");
        // Check whether WebGPU is available in Service Worker
        const request = {
          kind: "checkWebGPUAvilability",
          uuid: crypto.randomUUID(),
          content: "",
        };

        const sendEventInterval = setInterval(() => {
          navigator.serviceWorker.controller?.postMessage(request);
        }, 200);

        const webGPUCheckCallback = (event: MessageEvent) => {
          const message = event.data;
          if (message.kind === "return" && message.uuid === request.uuid) {
            const isWebGPUAvailable = message.content;
            log.info(
              isWebGPUAvailable
                ? "Service Worker has WebGPU Available."
                : "Service Worker does not have available WebGPU.",
            );
            if (!webllm && !isWebllmActive && !isWebllmInitialized.current) {
              setWebLLM(
                new WebLLMApi(
                  isWebGPUAvailable ? "serviceWorker" : "webWorker",
                  config.logLevel,
                ),
              );
              setWebllmAlive(true);
              isWebllmInitialized.current = true;
              clearTimeout(timeout);
            }
            navigator.serviceWorker.removeEventListener(
              "message",
              webGPUCheckCallback,
            );
            clearInterval(sendEventInterval);
          }
        };
        navigator.serviceWorker.addEventListener(
          "message",
          webGPUCheckCallback,
        );
      });
    } else {
      log.info(
        "Service Worker API is unavailable. Falling back to use web worker.",
      );
      if (!isWebllmInitialized.current && !webllm && !isWebllmActive) {
        setWebLLM(new WebLLMApi("webWorker", config.logLevel));
        setWebllmAlive(true);
        isWebllmInitialized.current = true;
        clearTimeout(timeout);
      }
    }
  }, []);

  // if (webllm?.webllm.type === "serviceWorker") {
  //   setInterval(() => {
  //     if (webllm) {
  //       // 10s per heartbeat, dead after 30 seconds of inactivity
  //       setWebllmAlive(
  //         !!webllm.webllm.engine &&
  //           (webllm.webllm.engine as ServiceWorkerMLCEngine).missedHeatbeat < 3,
  //       );
  //     }
  //   }, 10_000);
  // }
  return { webllm, isWebllmActive };
};

const useMlcLLM = () => {
  const config = useAppConfig();
  const [mlcllm, setMlcLlm] = useState<MlcLLMApi | undefined>(undefined);

  useEffect(() => {
    setMlcLlm(new MlcLLMApi(config.modelConfig.mlc_endpoint));
  }, [config.modelConfig.mlc_endpoint, setMlcLlm]);

  return mlcllm;
};

const useHyphaAgent = () => {
  const [hyphaAgent, setHyphaAgent] = useState<HyphaAgentApi | undefined>(
    undefined,
  );
  const { user, isConnected } = useHyphaStore();
  const store = useHyphaStore();
  const isInitializingRef = useRef(false);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Initialize HyphaAgent with store server connection
  useEffect(() => {
    log.info(
      `[useHyphaAgent] Effect triggered. User: ${!!user} Connected: ${isConnected} Already initialized: ${!!hyphaAgent} Initializing: ${isInitializingRef.current}`,
    );

    if (!user || !isConnected) {
      log.info(
        "[useHyphaAgent] User not authenticated or not connected, clearing agent",
      );
      if (hyphaAgent) {
        hyphaAgent.disconnect();
        setHyphaAgent(undefined);
      }
      isInitializingRef.current = false;
      return;
    }

    // Guard against double initialization
    if (hyphaAgent || isInitializingRef.current) {
      log.info(
        "[useHyphaAgent] Agent already exists or is initializing, skipping",
      );
      return;
    }

    // Mark as initializing
    isInitializingRef.current = true;

    // Add a small delay to ensure token is properly saved
    const initAgent = async () => {
      try {
        // Double-check initialization state
        if (!isInitializingRef.current) {
          log.info("[useHyphaAgent] Initialization cancelled");
          return;
        }

        // Check if token is available before creating agent
        const token = localStorage.getItem("token");
        if (!token) {
          log.warn(
            "[useHyphaAgent] No token available, delaying agent creation",
          );
          isInitializingRef.current = false;
          return;
        }

        log.info(
          "[useHyphaAgent] Creating new HyphaAgent with external server",
        );

        const agent = new HyphaAgentApi(
          "https://hypha.aicell.io",
          "hypha-agents/deno-app-engine",
          () => store.getServer(), // Wrap in arrow function to preserve context
        );

        // Only set the agent if we're still initializing (not cancelled)
        if (isInitializingRef.current) {
          setHyphaAgent(agent);
          log.info("[useHyphaAgent] HyphaAgent initialized successfully");
        } else {
          log.info(
            "[useHyphaAgent] Initialization was cancelled, disposing agent",
          );
          agent.disconnect();
        }
      } catch (error) {
        log.error("[useHyphaAgent] Failed to initialize HyphaAgent:", error);
      } finally {
        isInitializingRef.current = false;
      }
    };

    // Clear any existing timeout
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    // Delay initialization slightly to ensure token is available
    timeoutRef.current = setTimeout(initAgent, 100);

    // Cleanup timeout on unmount or dependency change
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      isInitializingRef.current = false;
    };
  }, [user, isConnected, store]); // Remove hyphaAgent from dependencies to prevent loops

  return hyphaAgent;
};

const useLoadUrlParam = () => {
  const config = useAppConfig();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    let modelConfig: any = {
      model: params.get("model"),
      temperature: params.has("temperature")
        ? parseFloat(params.get("temperature")!)
        : null,
      top_p: params.has("top_p") ? parseFloat(params.get("top_p")!) : null,
      max_tokens: params.has("max_tokens")
        ? parseInt(params.get("max_tokens")!)
        : null,
      presence_penalty: params.has("presence_penalty")
        ? parseFloat(params.get("presence_penalty")!)
        : null,
      frequency_penalty: params.has("frequency_penalty")
        ? parseFloat(params.get("frequency_penalty")!)
        : null,
    };
    Object.keys(modelConfig).forEach((key) => {
      // If the value of the key is null, delete the key
      if (modelConfig[key] === null) {
        delete modelConfig[key];
      }
    });
    if (Object.keys(modelConfig).length > 0) {
      log.info("Loaded model config from URL params", modelConfig);
      config.updateModelConfig(modelConfig);
    }
  }, []);
};

const useStopStreamingMessages = () => {
  const chatStore = useChatStore();

  // Clean up bad chat messages due to refresh during generating
  useEffect(() => {
    chatStore.stopStreaming();
  }, []);
};

const useLogLevel = (webllm?: WebLLMApi) => {
  const config = useAppConfig();

  // Update log level once app config loads
  useEffect(() => {
    log.setLevel(config.logLevel);
    if (webllm?.webllm?.engine) {
      webllm.webllm.engine.setLogLevel(config.logLevel);
    }
  }, [config.logLevel, webllm?.webllm?.engine]);
};

const useModels = (mlcllm: MlcLLMApi | undefined) => {
  const config = useAppConfig();

  useEffect(() => {
    if (config.modelClientType == ModelClient.WEBLLM) {
      config.setModels(DEFAULT_MODELS);
    } else if (config.modelClientType == ModelClient.MLCLLM_API) {
      if (mlcllm) {
        mlcllm.models().then((models) => {
          config.setModels(models);
        });
      }
    }
  }, [config.modelClientType, mlcllm]);
};

const useInitializeHypha = () => {
  const { initialize } = useHyphaStore();
  const isInitializedRef = useRef(false);

  // Memoize the initialize function to prevent unnecessary re-initializations
  const stableInitialize = useCallback(() => {
    if (!isInitializedRef.current) {
      isInitializedRef.current = true;
      initialize();
    }
  }, [initialize]);

  useEffect(() => {
    stableInitialize();
  }, [stableInitialize]);
};

export function Home() {
  const hasHydrated = useHasHydrated();
  const { webllm, isWebllmActive } = useWebLLM();
  const mlcllm = useMlcLLM();
  const hyphaAgent = useHyphaAgent();
  const config = useAppConfig(); // Move this hook call to the top
  const { user, isConnected } = useHyphaStore();
  const store = useHyphaStore();

  useSwitchTheme();
  useHtmlLang();
  useLoadUrlParam();
  useStopStreamingMessages();
  useModels(mlcllm);
  useLogLevel(webllm);
  useInitializeHypha();

  if (!hasHydrated) {
    return <Loading />;
  }

  // For HYPHA_AGENT client type, we don't need WebLLM
  if (config.modelClientType === ModelClient.HYPHA_AGENT) {
    // Clean up expired tokens first
    const token = localStorage.getItem("token");
    const tokenExpiry = localStorage.getItem("tokenExpiry");

    if (token && tokenExpiry) {
      try {
        const expiryDate = new Date(tokenExpiry);
        if (expiryDate <= new Date()) {
          // Token is expired, clear it
          localStorage.removeItem("token");
          localStorage.removeItem("tokenExpiry");
          localStorage.removeItem("user");
        }
      } catch (error) {
        // Invalid date format, clear tokens
        localStorage.removeItem("token");
        localStorage.removeItem("tokenExpiry");
        localStorage.removeItem("user");
      }
    }

    // Always show the interface - don't show loading for HYPHA_AGENT
    // Users can interact with the chat and log in as needed
  } else {
    // For other client types, we need WebLLM
    if (!webllm || !isWebllmActive) {
      return <Loading />;
    }

    if (!isWebllmActive) {
      return <ErrorScreen message={Locale.ServiceWorker.Error} />;
    }
  }

  return (
    <ErrorBoundary>
      <Router>
        <WebLLMContext.Provider value={webllm}>
          <MLCLLMContext.Provider value={mlcllm}>
            <HyphaAgentContext.Provider value={hyphaAgent}>
              <Screen />
            </HyphaAgentContext.Provider>
          </MLCLLMContext.Provider>
        </WebLLMContext.Provider>
      </Router>
    </ErrorBoundary>
  );
}
