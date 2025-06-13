import { useDebouncedCallback } from "use-debounce";
import React, {
  useState,
  useRef,
  useEffect,
  useMemo,
  useCallback,
  Fragment,
  RefObject,
  useContext,
} from "react";

import ShareIcon from "../icons/share.svg";
import SendWhiteIcon from "../icons/send-white.svg";
import RenameIcon from "../icons/rename.svg";
import ExportIcon from "../icons/export.svg";
import ReturnIcon from "../icons/return.svg";
import CopyIcon from "../icons/copy.svg";
import LoadingIcon from "../icons/three-dots.svg";
import LoadingButtonIcon from "../icons/loading.svg";
import PromptIcon from "../icons/prompt.svg";
import MaxIcon from "../icons/max.svg";
import MinIcon from "../icons/min.svg";
import ResetIcon from "../icons/reload.svg";
import BreakIcon from "../icons/break.svg";
import DeleteIcon from "../icons/clear.svg";
import EditIcon from "../icons/rename.svg";
import ConfirmIcon from "../icons/confirm.svg";
import ImageIcon from "../icons/image.svg";
import BrainIcon from "../icons/brain.svg";
import AttachmentIcon from "../icons/attachment.svg";

import BottomIcon from "../icons/bottom.svg";
import StopIcon from "../icons/pause.svg";
import RobotIcon from "../icons/robot.svg";

import {
  ChatMessage,
  SubmitKey,
  useChatStore,
  BOT_HELLO,
  createMessage,
  useAppConfig,
  DEFAULT_TOPIC,
  Model,
  ModelClient,
} from "../store";

import {
  copyToClipboard,
  selectOrCopy,
  autoGrowTextArea,
  useMobileScreen,
  getMessageTextContent,
  getMessageImages,
  isVisionModel,
  compressImage,
} from "../utils";

import dynamic from "next/dynamic";

import { Prompt, usePromptStore } from "../store/prompt";
import Locale from "../locales";

import { IconButton } from "./button";
import LoginButton from "./login-button";
import styles from "./chat.module.scss";

import {
  List,
  ListItem,
  Modal,
  Popover,
  showConfirm,
  showPrompt,
  showToast,
} from "./ui-lib";
import { useNavigate } from "react-router-dom";
import {
  CHAT_PAGE_SIZE,
  LAST_INPUT_KEY,
  Path,
  REQUEST_TIMEOUT_MS,
  UNFINISHED_INPUT,
} from "../constant";
import { Avatar, AvatarPicker } from "./emoji";
import { ContextPrompts, TemplateAvatar } from "./template";
import { ChatCommandPrefix, useChatCommand, useCommand } from "../command";
import { prettyObject } from "../utils/format";
import { ExportMessageModal } from "./exporter";
import { MultimodalContent } from "../client/api";
import { Template, useTemplateStore } from "../store/template";
import Image from "next/image";
import { MLCLLMContext, WebLLMContext, HyphaAgentContext } from "../context";
import { ChatImage } from "../typing";
import AgentSelect from "./model-select";
import { ErrorBoundary } from "./error";
import { InputRange } from "./input-range";

import { useHyphaStore } from "../store/hypha";
import { AgentConfig } from "../client/hypha-agent";

export function ScrollDownToast(prop: { show: boolean; onclick: () => void }) {
  return (
    <div
      className={
        styles["toast-container"] + (prop.show ? ` ${styles["show"]}` : "")
      }
    >
      <div className={styles["toast-content"]} onClick={() => prop.onclick()}>
        <BottomIcon />
      </div>
    </div>
  );
}

export function SessionConfigModel(props: { onClose: () => void }) {
  const [showPicker, setShowPicker] = useState(false);
  const config = useAppConfig();
  const chatStore = useChatStore();
  const session = chatStore.currentSession();
  const templateStore = useTemplateStore();
  const navigate = useNavigate();

  const updateTemplate = (updater: (value: Template) => void) => {
    const template = { ...session.template };
    updater(template);
    chatStore.updateCurrentSession((session) => (session.template = template));
  };

  return (
    <div className="screen-model-container">
      <Modal
        title={Locale.Context.Edit}
        onClose={() => props.onClose()}
        actions={[
          <IconButton
            key="reset"
            icon={<ResetIcon />}
            bordered
            text={Locale.Chat.Config.Reset}
            onClick={async () => {
              if (await showConfirm(Locale.Memory.ResetConfirm)) {
                chatStore.updateCurrentSession(
                  (session) => (session.memoryPrompt = ""),
                );
              }
            }}
          />,
          <IconButton
            key="copy"
            icon={<CopyIcon />}
            bordered
            text={Locale.Chat.Config.SaveAs}
            onClick={() => {
              showPrompt(Locale.Template.Config.Name, session.topic, 1).then(
                (templateName) => {
                  updateTemplate((template) => {
                    template.name = templateName;
                  });
                  navigate(Path.Templates);
                  setTimeout(() => {
                    templateStore.create(session.template);
                  }, 500);
                },
              );
            }}
          />,
          <IconButton
            type="primary"
            key="ok"
            icon={<ConfirmIcon />}
            bordered
            text={Locale.Chat.Config.Confirm}
            onClick={props.onClose}
          />,
        ]}
      >
        <ContextPrompts
          context={session.template.context}
          updateContext={(updater) => {
            const context = session.template.context.slice();
            updater(context);
            updateTemplate((template) => (template.context = context));
          }}
        />

        <List>
          <ListItem
            title={Locale.Chat.EditMessage.Topic.Title}
            subTitle={Locale.Chat.EditMessage.Topic.SubTitle}
          >
            <input
              type="text"
              value={session.topic}
              onInput={(e) =>
                chatStore.updateCurrentSession(
                  (session) => (session.topic = e.currentTarget.value),
                )
              }
              aria-label="Chat topic"
            ></input>
          </ListItem>
          <ListItem title={Locale.Template.Config.Avatar}>
            <Popover
              content={
                <AvatarPicker
                  onEmojiClick={(emoji) => {
                    updateTemplate((template) => (template.avatar = emoji));
                    setShowPicker(false);
                  }}
                ></AvatarPicker>
              }
              open={showPicker}
              onClose={() => setShowPicker(false)}
            >
              <div
                onClick={() => setShowPicker(true)}
                style={{ cursor: "pointer" }}
              >
                <TemplateAvatar
                  avatar={session.template.avatar}
                  model={config.modelConfig.model}
                />
              </div>
            </Popover>
          </ListItem>
          <ListItem
            title={Locale.Template.Config.HideContext.Title}
            subTitle={Locale.Template.Config.HideContext.SubTitle}
          >
            <input
              type="checkbox"
              checked={session.template.hideContext}
              onChange={(e) => {
                updateTemplate((template) => {
                  template.hideContext = e.currentTarget.checked;
                });
              }}
              aria-label="Hide context"
            ></input>
          </ListItem>
        </List>
      </Modal>
    </div>
  );
}

const Markdown = dynamic(async () => (await import("./markdown")).Markdown, {
  loading: () => <LoadingIcon />,
});

function useSubmitHandler() {
  const config = useAppConfig();
  const submitKey = config.submitKey;
  const isComposing = useRef(false);

  useEffect(() => {
    const onCompositionStart = () => {
      isComposing.current = true;
    };
    const onCompositionEnd = () => {
      isComposing.current = false;
    };

    window.addEventListener("compositionstart", onCompositionStart);
    window.addEventListener("compositionend", onCompositionEnd);

    return () => {
      window.removeEventListener("compositionstart", onCompositionStart);
      window.removeEventListener("compositionend", onCompositionEnd);
    };
  }, []);

  const shouldSubmit = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Fix Chinese input method "Enter" on Safari
    if (e.keyCode == 229) return false;
    if (e.key !== "Enter") return false;
    if (e.key === "Enter" && (e.nativeEvent.isComposing || isComposing.current))
      return false;
    return (
      (config.submitKey === SubmitKey.AltEnter && e.altKey) ||
      (config.submitKey === SubmitKey.CtrlEnter && e.ctrlKey) ||
      (config.submitKey === SubmitKey.ShiftEnter && e.shiftKey) ||
      (config.submitKey === SubmitKey.MetaEnter && e.metaKey) ||
      (config.submitKey === SubmitKey.Enter &&
        !e.altKey &&
        !e.ctrlKey &&
        !e.shiftKey &&
        !e.metaKey)
    );
  };

  return {
    submitKey,
    shouldSubmit,
  };
}

export type RenderPompt = Pick<Prompt, "title" | "content">;

export function PromptHints(props: {
  prompts: RenderPompt[];
  onPromptSelect: (prompt: RenderPompt) => void;
}) {
  const noPrompts = props.prompts.length === 0;
  const [selectIndex, setSelectIndex] = useState(0);
  const selectedRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setSelectIndex(0);
  }, [props.prompts.length]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (noPrompts || e.metaKey || e.altKey || e.ctrlKey) {
        return;
      }
      // arrow up / down to select prompt
      const changeIndex = (delta: number) => {
        e.stopPropagation();
        e.preventDefault();
        const nextIndex = Math.max(
          0,
          Math.min(props.prompts.length - 1, selectIndex + delta),
        );
        setSelectIndex(nextIndex);
        selectedRef.current?.scrollIntoView({
          block: "center",
        });
      };

      if (e.key === "ArrowUp") {
        changeIndex(1);
      } else if (e.key === "ArrowDown") {
        changeIndex(-1);
      } else if (e.key === "Enter") {
        const selectedPrompt = props.prompts.at(selectIndex);
        if (selectedPrompt) {
          props.onPromptSelect(selectedPrompt);
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);

    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.prompts.length, selectIndex]);

  if (noPrompts) return null;
  return (
    <div className={styles["prompt-hints"]}>
      {props.prompts.map((prompt, i) => (
        <div
          ref={i === selectIndex ? selectedRef : null}
          className={
            styles["prompt-hint"] +
            ` ${i === selectIndex ? styles["prompt-hint-selected"] : ""}`
          }
          key={prompt.title + i.toString()}
          onClick={() => props.onPromptSelect(prompt)}
          onMouseEnter={() => setSelectIndex(i)}
        >
          <div className={styles["hint-title"]}>{prompt.title}</div>
          <div className={styles["hint-content"]}>{prompt.content}</div>
        </div>
      ))}
    </div>
  );
}

function ClearContextDivider() {
  const chatStore = useChatStore();

  return (
    <div
      className={styles["clear-context"]}
      onClick={() =>
        chatStore.updateCurrentSession(
          (session) => (session.clearContextIndex = undefined),
        )
      }
    >
      <div className={styles["clear-context-tips"]}>{Locale.Context.Clear}</div>
      <div className={styles["clear-context-revert-btn"]}>
        {Locale.Context.Revert}
      </div>
    </div>
  );
}

function ChatAction(props: {
  text: string;
  icon: JSX.Element;
  onClick: () => void;
  fullWidth?: boolean;
  selected?: boolean;
}) {
  const iconRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState({
    full: 16,
    icon: 16,
  });

  function updateWidth() {
    if (!iconRef.current || !textRef.current) return;
    const getWidth = (dom: HTMLDivElement) => dom.getBoundingClientRect().width;
    const textWidth = getWidth(textRef.current);
    const iconWidth = getWidth(iconRef.current);
    setWidth({
      full: textWidth + iconWidth,
      icon: iconWidth,
    });
  }

  return props.fullWidth ? (
    <div
      className={`${styles["chat-input-action"]} clickable ${styles["full-width"]} ${props.selected ? styles["selected"] : ""}`}
      onClick={props.onClick}
    >
      <div ref={iconRef} className={styles["icon"]}>
        {props.icon}
      </div>
      <div className={styles["text"]} ref={textRef}>
        {props.text}
      </div>
    </div>
  ) : (
    <div
      className={`${styles["chat-input-action"]} clickable ${props.selected ? styles["selected"] : ""}`}
      onClick={() => {
        props.onClick();
        setTimeout(updateWidth, 1);
      }}
      onMouseEnter={updateWidth}
      onTouchStart={updateWidth}
      style={
        {
          "--icon-width": `${width.icon}px`,
          "--full-width": `${width.full}px`,
        } as React.CSSProperties
      }
    >
      <div ref={iconRef} className={styles["icon"]}>
        {props.icon}
      </div>
      <div className={styles["text"]} ref={textRef}>
        {props.text}
      </div>
    </div>
  );
}

function FileUploadAction() {
  const { user, isConnected, uploadFileToProject } = useHyphaStore();
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleClick = async () => {
    if (!isConnected || !user) {
      showToast("Please log in to upload files");
      return;
    }

    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  const handleFileChange = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    const file = files[0];

    // File size limit (10MB)
    const maxSize = 10 * 1024 * 1024;
    if (file.size > maxSize) {
      showToast("File too large. Maximum size is 10MB.");
      return;
    }

    try {
      setIsUploading(true);
      setUploadProgress(0);

      // Upload file with progress tracking using store function
      await uploadFileToProject(file, (progress: number) => {
        setUploadProgress(progress);
      });

      showToast(`File "${file.name}" uploaded successfully!`);
    } catch (error) {
      console.error("File upload failed:", error);
      showToast(
        `Upload failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    } finally {
      setIsUploading(false);
      setUploadProgress(0);
      // Reset file input
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const getText = () => {
    if (isUploading) {
      return `Uploading... ${uploadProgress}%`;
    }
    return Locale.Chat.InputActions.UploadFile;
  };

  const getIcon = () => {
    if (isUploading) {
      return <LoadingButtonIcon />;
    }
    // Use inline SVG attachment icon
    return (
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66L9.48 16.35a2 2 0 0 1-2.83-2.83l8.36-8.36" />
      </svg>
    );
  };

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        onChange={handleFileChange}
        style={{ display: "none" }}
        accept="*/*"
        aria-label="Upload file"
      />
      <ChatAction onClick={handleClick} text={getText()} icon={getIcon()} />
    </>
  );
}

const INITIALIZATION_SCRIPT = ``;

function useScrollToBottom(
  scrollRef: RefObject<HTMLDivElement>,
  detach: boolean = false,
) {
  // for auto-scroll

  const [autoScroll, setAutoScroll] = useState(true);
  function scrollDomToBottom() {
    const dom = scrollRef.current;
    if (dom) {
      requestAnimationFrame(() => {
        setAutoScroll(true);
        dom.scrollTo(0, dom.scrollHeight);
      });
    }
  }

  // auto scroll
  useEffect(() => {
    if (autoScroll && !detach) {
      scrollDomToBottom();
    }
  });

  return {
    scrollRef,
    autoScroll,
    setAutoScroll,
    scrollDomToBottom,
  };
}

export function ChatActions(props: {
  uploadImage: () => void;
  setAttachImages: (images: ChatImage[]) => void;
  setUploading: (uploading: boolean) => void;
  scrollToBottom: () => void;
  showPromptSetting: () => void;
  showPromptHints: () => void;
  hitBottom: boolean;
  uploading: boolean;
}) {
  const chatStore = useChatStore();
  const config = useAppConfig();
  const currentModel = config.modelConfig.model;
  const models = config.models;
  const { resources } = useHyphaStore();

  const [showModelSelector, setShowModelSelector] = useState(false);
  const [showUploadImage, setShowUploadImage] = useState(false);

  const { setAttachImages, setUploading } = props;

  const getCurrentDisplayName = () => {
    if (config.modelClientType === ModelClient.HYPHA_AGENT) {
      return config.modelConfig.selectedAgent?.name || "";
    }
    return (
      models.find((m) => m.name === currentModel)?.display_name || currentModel
    );
  };

  useEffect(() => {
    const show = isVisionModel(currentModel);
    setShowUploadImage(show);
    if (!show) {
      setAttachImages([]);
      setUploading(false);
    }
  }, [currentModel, models, setAttachImages, setUploading]);

  return (
    <div className={styles["chat-input-actions"]}>
      {showUploadImage && (
        <ChatAction
          onClick={props.uploadImage}
          text={Locale.Chat.InputActions.UploadImage}
          icon={props.uploading ? <LoadingButtonIcon /> : <ImageIcon />}
        />
      )}
      <FileUploadAction />
      <ChatAction
        onClick={props.showPromptSetting}
        text={Locale.Chat.Actions.EditConversation}
        icon={<EditIcon />}
      />
      <ChatAction
        onClick={props.showPromptHints}
        text={Locale.Chat.InputActions.QuickPrompt}
        icon={<PromptIcon />}
      />
      <ChatAction
        text={Locale.Chat.InputActions.Clear}
        icon={<BreakIcon />}
        onClick={() => {
          chatStore.updateCurrentSession((session) => {
            if (session.clearContextIndex === session.messages.length) {
              session.clearContextIndex = undefined;
            } else {
              session.clearContextIndex = session.messages.length;
              session.memoryPrompt = ""; // will clear memory
            }
          });
        }}
      />
      {config.modelConfig.model.toLowerCase().startsWith("qwen3") && (
        <ChatAction
          onClick={() =>
            config.update(
              (config) => (config.enableThinking = !config.enableThinking),
            )
          }
          text={Locale.Settings.THINKING}
          icon={<BrainIcon />}
          selected={config.enableThinking}
        />
      )}
      <ChatAction
        onClick={() => setShowModelSelector(true)}
        text={getCurrentDisplayName()}
        icon={<RobotIcon />}
        fullWidth
      />
      {showModelSelector && (
        <AgentSelect
          onClose={() => {
            setShowModelSelector(false);
          }}
          selectedAgent={config.modelConfig.selectedAgent?.id}
          onSelectAgent={(agentId: string) => {
            // Find the agent resource from resources
            const agent = resources.find((r: any) => r.id === agentId);
            if (!agent) {
              showToast(`Agent not found: ${agentId}`);
              return;
            }

            // Switch to Hypha Agent client and select agent
            config.update((config) => {
              config.modelClientType = ModelClient.HYPHA_AGENT;
            });
            config.selectAgent(agentId, agent.manifest.name);
            showToast(`Selected: ${agent.manifest.name}`);
            setShowModelSelector(false);
          }}
        />
      )}
    </div>
  );
}

export function DeleteImageButton(props: { deleteImage: () => void }) {
  return (
    <div className={styles["delete-image"]} onClick={props.deleteImage}>
      <DeleteIcon />
    </div>
  );
}

function _Chat() {
  type RenderMessage = ChatMessage & { preview?: boolean };

  const chatStore = useChatStore();
  const session = chatStore.currentSession();
  const config = useAppConfig();
  const fontSize = config.fontSize;

  const isStreaming = session.messages.some((m) => m.streaming);

  const [showExport, setShowExport] = useState(false);

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [userInput, setUserInput] = useState("");
  const { submitKey, shouldSubmit } = useSubmitHandler();
  const scrollRef = useRef<HTMLDivElement>(null);
  const isScrolledToBottom = scrollRef?.current
    ? Math.abs(
        scrollRef.current.scrollHeight -
          (scrollRef.current.scrollTop + scrollRef.current.clientHeight),
      ) <= 1
    : false;
  const { setAutoScroll, scrollDomToBottom } = useScrollToBottom(
    scrollRef,
    isScrolledToBottom,
  );
  const [hitBottom, setHitBottom] = useState(true);
  const isMobileScreen = useMobileScreen();
  const navigate = useNavigate();
  const [attachImages, setAttachImages] = useState<ChatImage[]>([]);
  const [uploading, setUploading] = useState(false);
  const [showEditPromptModal, setShowEditPromptModal] = useState(false);
  const webllm = useContext(WebLLMContext);
  const mlcllm = useContext(MLCLLMContext);
  const hyphaAgent = useContext(HyphaAgentContext);

  const models = config.models;
  const { resources, isConnected, user, fetchResources } = useHyphaStore();

  // Memoize selected agent resource to prevent unnecessary re-renders
  const selectedAgentResource = useMemo(() => {
    const selectedAgent = config.modelConfig.selectedAgent;
    if (!selectedAgent || !resources || resources.length === 0) return null;

    // Stable comparison using agent ID
    const agentId = selectedAgent.id;
    return resources.find((r: any) => r.id === agentId) || null;
  }, [config.modelConfig.selectedAgent?.id, resources.length]); // Use resources.length instead of resources array

  // Track agent readiness for Hypha Agent client
  const [isAgentReady, setIsAgentReady] = useState(false);

  // prompt hints
  const promptStore = usePromptStore();
  const [promptHints, setPromptHints] = useState<RenderPompt[]>([]);
  const onSearch = useDebouncedCallback(
    (text: string) => {
      const matchedPrompts = promptStore.search(text);
      setPromptHints(matchedPrompts);
    },
    100,
    { leading: true, trailing: true },
  );

  // auto grow input
  const [inputRows, setInputRows] = useState(2);
  const measure = useDebouncedCallback(
    () => {
      const rows = inputRef.current ? autoGrowTextArea(inputRef.current) : 1;
      const inputRows = Math.min(
        20,
        Math.max(2 + Number(!isMobileScreen), rows),
      );
      setInputRows(inputRows);
    },
    100,
    {
      leading: true,
      trailing: true,
    },
  );

  // chat commands shortcuts
  const chatCommands = useChatCommand({
    new: () => chatStore.newSession(),
    prev: () => chatStore.nextSession(-1),
    next: () => chatStore.nextSession(1),
    clear: () =>
      chatStore.updateCurrentSession(
        (session) => (session.clearContextIndex = session.messages.length),
      ),
    del: () => chatStore.deleteSession(chatStore.currentSessionIndex),
  });

  // Track created agents to prevent duplicates
  const createdAgentsRef = useRef<Record<string, boolean>>({});

  // auto grow input effect
  useEffect(measure, [userInput]);

  // Reset session status on initial loading
  useEffect(() => {
    chatStore.resetGeneratingStatus();
  }, []);

  useEffect(() => {
    chatStore.updateCurrentSession((session) => {
      const stopTiming = Date.now() - REQUEST_TIMEOUT_MS;
      session.messages.forEach((m) => {
        // check if should stop all stale messages
        if (m.isError || new Date(m.date).getTime() < stopTiming) {
          if (m.streaming) {
            m.streaming = false;
          }

          if (m.content.length === 0) {
            m.isError = true;
            m.content = prettyObject({
              error: true,
              message: "empty response",
            });
          }
        }
      });
      session.messages = session.messages.filter((m) => m.content.length > 0);
    });
  }, []);

  // Clear created agents when switching client types
  useEffect(() => {
    if (config.modelClientType !== ModelClient.HYPHA_AGENT) {
      createdAgentsRef.current = {};
    }
  }, [config.modelClientType]);

  // Fetch resources when user connects
  useEffect(() => {
    if (
      config.modelClientType === ModelClient.HYPHA_AGENT &&
      isConnected &&
      user &&
      resources.length === 0
    ) {
      console.log("[Chat] Fetching agent resources...");
      fetchResources(1).catch((error) => {
        console.error("[Chat] Failed to fetch resources:", error);
      });
    }
  }, [
    config.modelClientType,
    isConnected,
    user,
    resources.length,
    fetchResources,
  ]);

  // Create agent automatically when using Hypha Agent client
  useEffect(() => {
    if (config.modelClientType !== ModelClient.HYPHA_AGENT || !hyphaAgent) {
      setIsAgentReady(config.modelClientType !== ModelClient.HYPHA_AGENT);
      return;
    }

    // Only proceed if user is connected to Hypha server
    if (!isConnected || !user) {
      console.log("[Chat] Waiting for Hypha server connection...");
      setIsAgentReady(false);
      return;
    }

    // If we have a selectedAgent but no selectedAgentResource and resources is not empty,
    // it means resources are still loading
    const selectedAgent = config.modelConfig.selectedAgent;
    if (selectedAgent && !selectedAgentResource && resources.length > 0) {
      console.log(
        "[Chat] Agent resources loaded, looking for selected agent...",
      );
      const resource = resources.find((r) => r.id === selectedAgent.id);
      if (resource) {
        console.log("[Chat] Found agent resource:", resource.name);
        // Note: selectedAgentResource is computed from useMemo, can't set it directly
      } else {
        console.warn("[Chat] Selected agent not found in resources");
      }
      return;
    }

    if (!selectedAgentResource) {
      console.log("[Chat] No agent resource selected");

      // Auto-select the first available agent if none is selected
      if (resources.length > 0 && !selectedAgent) {
        const firstAgent = resources.find((r) =>
          r.manifest.type?.includes("agent"),
        );

        if (firstAgent) {
          console.log(
            "[Chat] Auto-selecting first available agent:",
            firstAgent.id,
          );
          config.updateModelConfig({
            selectedAgent: {
              id: firstAgent.id,
              name: firstAgent.manifest.name || firstAgent.name,
            },
          });
          return; // Exit and let the effect re-run with the selected agent
        }
      }

      setIsAgentReady(false);
      return;
    }

    let cancelled = false;

    const createOrFindAgent = async () => {
      try {
        // Generate the expected agent ID based on session and selected agent resource
        const agentId = `${session.id}@${selectedAgentResource.id.split("/").pop() || selectedAgentResource.id}`;

        console.log("[Chat] Looking for or creating agent:", agentId);

        // Check if we already created this specific agent
        if (createdAgentsRef.current[agentId]) {
          console.log("[Chat] Agent already created:", agentId);
          hyphaAgent.setAgentId(agentId);
          if (!cancelled) setIsAgentReady(true);
          return;
        }

        // List existing agents to see if one already exists with this ID
        console.log("[Chat] Checking existing agents...");
        const existingAgents = await hyphaAgent.listAgents();
        console.log("[Chat] Checking existing agents:", existingAgents);

        // Look for exact match first
        let existingAgent = existingAgents.find((agent) =>
          agent.id.endsWith(agentId),
        );

        if (existingAgent) {
          console.log(
            "[Chat] Found existing exact match agent:",
            existingAgent.id,
          );
          hyphaAgent.setAgentId(existingAgent.id);
          createdAgentsRef.current[agentId] = true;
          if (!cancelled) setIsAgentReady(true);
          return;
        }

        // If no exact match found, create new agent
        console.log("[Chat] Creating new agent...");

        let agentToCreate: any = null;

        if (selectedAgent) {
          if (selectedAgentResource) {
            // Use selected agent configuration with session-based naming
            agentToCreate = {
              id: agentId,
              name: `${selectedAgentResource.manifest?.name || selectedAgent.name} (${session.id.slice(-8)})`,
              instructions:
                (selectedAgentResource.manifest as any)?.instructions ||
                selectedAgentResource.description ||
                "You are a helpful AI assistant.",
              kernelType: "PYTHON",
              autoAttachKernel: true,
              startupScript:
                INITIALIZATION_SCRIPT +
                "\n" +
                (selectedAgentResource.manifest?.startup_script || ""),
              enablePlanning: true,
              maxSteps: 10,
            };
          } else {
            // Agent not found in resources, use fallback with stored name
            console.warn(
              "[Chat] Could not find full resource for agent:",
              selectedAgent.id,
            );
            agentToCreate = {
              id: agentId,
              name: `${selectedAgent.name} (${session.id.slice(-8)})`,
              instructions: "You are a helpful AI assistant.",
              kernelType: "PYTHON",
              autoAttachKernel: true,
              startupScript: INITIALIZATION_SCRIPT,
              enablePlanning: true,
              maxSteps: 10,
            };
          }
        } else {
          // Create default agent with session-based naming
          agentToCreate = {
            id: agentId,
            name: `Chat Assistant (${session.id.slice(-8)})`,
            instructions: "You are a helpful AI assistant.",
            kernelType: "PYTHON",
            autoAttachKernel: true,
            startupScript: INITIALIZATION_SCRIPT,
          };
        }

        console.log(
          "[Chat] Creating agent for session:",
          session.id,
          "with startup script:",
          agentToCreate.startupScript,
        );
        console.log("[Chat] Agent config:", agentToCreate);

        const newAgent = await hyphaAgent.createAgent(agentToCreate);
        console.log("[Chat] Agent created successfully:", newAgent.id);

        hyphaAgent.setAgentId(newAgent.id);
        createdAgentsRef.current[agentId] = true;
        if (!cancelled) setIsAgentReady(true);
      } catch (error) {
        console.error("[Chat] Failed to create/find agent:", error);
        if (!cancelled) {
          setIsAgentReady(false);
          showToast(
            `Failed to initialize agent: ${error instanceof Error ? error.message : "Unknown error"}`,
          );
        }
      }
    };

    createOrFindAgent();

    return () => {
      cancelled = true;
    };
  }, [
    config.modelClientType,
    hyphaAgent,
    selectedAgentResource,
    session.id,
    isConnected,
    user,
    resources,
    config.modelConfig.selectedAgent?.id,
  ]);

  const context: RenderMessage[] = useMemo(() => {
    return session.template.hideContext ? [] : session.template.context.slice();
  }, [session.template.context, session.template.hideContext]);

  // preview messages
  const renderMessages = useMemo(() => {
    const contextWithHello =
      context.length === 0 &&
      session.messages.at(0)?.content !== BOT_HELLO.content
        ? [...context, Object.assign({}, BOT_HELLO) as RenderMessage]
        : context;

    const baseMessages = (contextWithHello as RenderMessage[]).concat(
      session.messages as RenderMessage[],
    );

    const previewMessage =
      userInput.length > 0 && config.sendPreviewBubble
        ? [
            {
              ...createMessage({
                role: "user",
                content: userInput,
              }),
              preview: true,
            } as RenderMessage,
          ]
        : [];

    return baseMessages.concat(previewMessage);
  }, [
    config.sendPreviewBubble,
    context,
    session.messages,
    session.messages.length,
    userInput,
  ]);

  const [msgRenderIndex, _setMsgRenderIndex] = useState(
    Math.max(0, renderMessages.length - CHAT_PAGE_SIZE),
  );

  function setMsgRenderIndex(newIndex: number) {
    newIndex = Math.min(renderMessages.length - CHAT_PAGE_SIZE, newIndex);
    newIndex = Math.max(0, newIndex);
    _setMsgRenderIndex(newIndex);
  }

  const messages = useMemo(() => {
    const endRenderIndex = Math.min(
      msgRenderIndex + 3 * CHAT_PAGE_SIZE,
      renderMessages.length,
    );
    return renderMessages.slice(msgRenderIndex, endRenderIndex);
  }, [msgRenderIndex, renderMessages]);

  const autoFocus = !isMobileScreen; // wont auto focus on mobile screen
  const showMaxIcon = !isMobileScreen;

  const handlePaste = useCallback(
    async (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
      const currentModel = config.modelConfig.model;
      if (!isVisionModel(currentModel)) {
        return;
      }
      const items =
        event.clipboardData.items || (await navigator.clipboard.read());
      for (const item of items) {
        if (item.kind === "file" && item.type.startsWith("image/")) {
          event.preventDefault();
          const file = item.getAsFile();
          if (file) {
            const images: ChatImage[] = [];
            images.push(...attachImages);
            images.push(
              ...(await new Promise<ChatImage[]>((res, rej) => {
                setUploading(true);
                const imagesData: ChatImage[] = [];
                compressImage(file, 256 * 1024)
                  .then((imageData) => {
                    imagesData.push(imageData);
                    setUploading(false);
                    res(imagesData);
                  })
                  .catch((e) => {
                    setUploading(false);
                    rej(e);
                  });
              })),
            );
            const imagesLength = images.length;

            if (imagesLength > 3) {
              images.splice(3, imagesLength - 3);
            }
            setAttachImages(images);
          }
        }
      }
    },
    [attachImages, config.modelConfig.model],
  );

  // remember unfinished input
  useEffect(() => {
    // try to load from local storage
    const key = UNFINISHED_INPUT(session.id);
    const mayBeUnfinishedInput = localStorage.getItem(key);
    if (mayBeUnfinishedInput && userInput.length === 0) {
      setUserInput(mayBeUnfinishedInput);
      localStorage.removeItem(key);
    }

    const dom = inputRef.current;
    return () => {
      localStorage.setItem(key, dom?.value ?? "");
    };
  }, [session.id, userInput.length]);

  useCommand({
    fill: setUserInput,
    submit: (text) => {
      onSubmit(text);
    },
  });

  const llm =
    config.modelClientType === ModelClient.MLCLLM_API
      ? mlcllm
      : config.modelClientType === ModelClient.HYPHA_AGENT
        ? hyphaAgent
        : webllm;

  // Early return if LLM is not available - moved after all hooks
  // For HYPHA_AGENT, only show loading if user is authenticated but agent not ready
  if (!llm) {
    if (config.modelClientType === ModelClient.HYPHA_AGENT) {
      // If user is not authenticated, don't show loading - let them see the login interface
      if (!isConnected || !user) {
        // Continue to render the chat interface which will show login button
      } else {
        // User is authenticated but agent not ready - show loading
        return <div>Loading LLM...</div>;
      }
    } else {
      // For other client types, always show loading if LLM not available
      return <div>Loading LLM...</div>;
    }
  }

  // only search prompts when user input is short
  const SEARCH_TEXT_LIMIT = 30;
  const onInput = (text: string) => {
    setUserInput(text);
    const n = text.trim().length;

    // clear search results
    if (n === 0) {
      setPromptHints([]);
    } else if (text.startsWith(ChatCommandPrefix)) {
      setPromptHints(chatCommands.search(text));
    } else if (!config.disablePromptHint && n < SEARCH_TEXT_LIMIT) {
      // check if need to trigger auto completion
      if (text.startsWith("/")) {
        let searchText = text.slice(1);
        onSearch(searchText);
      }
    }
  };

  const onSubmit = (userInput: string) => {
    if (userInput.trim() === "") return;

    const matchCommand = chatCommands.match(userInput);
    if (matchCommand.matched) {
      setUserInput("");
      setPromptHints([]);
      matchCommand.invoke();
      return;
    }

    if (isStreaming) return;

    // Check if agent is ready for Hypha Agent client
    if (config.modelClientType === ModelClient.HYPHA_AGENT && !isAgentReady) {
      console.warn("[Chat] Agent not ready yet, please wait...");
      return;
    }

    if (llm) {
      chatStore.onUserInput(userInput, llm, attachImages);
    }
    setAttachImages([]);
    localStorage.setItem(LAST_INPUT_KEY, userInput);
    setUserInput("");
    setPromptHints([]);
    if (!isMobileScreen) inputRef.current?.focus();
    setAutoScroll(true);
  };

  const onPromptSelect = (prompt: RenderPompt) => {
    setTimeout(() => {
      setPromptHints([]);

      const matchedChatCommand = chatCommands.match(prompt.content);
      if (matchedChatCommand.matched) {
        // if user is selecting a chat command, just trigger it
        matchedChatCommand.invoke();
        setUserInput("");
      } else {
        // or fill the prompt
        setUserInput(prompt.content);
      }
      inputRef.current?.focus();
    }, 30);
  };

  // stop response
  const onUserStop = () => {
    if (llm) {
      llm.abort();
    }
    chatStore.stopStreaming();
  };

  // check if should send message
  const onInputKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // if ArrowUp and no userInput, fill with last input
    if (
      e.key === "ArrowUp" &&
      userInput.length <= 0 &&
      !(e.metaKey || e.altKey || e.ctrlKey)
    ) {
      setUserInput(localStorage.getItem(LAST_INPUT_KEY) ?? "");
      e.preventDefault();
      return;
    }
    if (shouldSubmit(e) && promptHints.length === 0) {
      onSubmit(userInput);
      e.preventDefault();
    }
  };

  const onRightClick = (e: any, message: ChatMessage) => {
    // copy to clipboard
    if (selectOrCopy(e.currentTarget, getMessageTextContent(message))) {
      if (userInput.length === 0) {
        setUserInput(getMessageTextContent(message));
      }

      e.preventDefault();
    }
  };

  const deleteMessage = (msgId?: string) => {
    chatStore.updateCurrentSession(
      (session) =>
        (session.messages = session.messages.filter((m) => m.id !== msgId)),
    );
  };

  const onDelete = (msgId: string) => {
    deleteMessage(msgId);
  };

  const onResend = (message: ChatMessage) => {
    // when it is resending a message
    // 1. for a user's message, find the next bot response
    // 2. for a bot's message, find the last user's input
    // 3. delete original user input and bot's message
    // 4. resend the user's input

    const resendingIndex = session.messages.findIndex(
      (m) => m.id === message.id,
    );

    if (resendingIndex < 0 || resendingIndex >= session.messages.length) {
      console.error("[Chat] failed to find resending message", message);
      return;
    }

    let userMessage: ChatMessage | undefined;
    let botMessage: ChatMessage | undefined;

    if (message.role === "assistant") {
      // if it is resending a bot's message, find the user input for it
      botMessage = message;
      for (let i = resendingIndex; i >= 0; i -= 1) {
        if (session.messages[i].role === "user") {
          userMessage = session.messages[i];
          break;
        }
      }
    } else if (message.role === "user") {
      // if it is resending a user's input, find the bot's response
      userMessage = message;
      for (let i = resendingIndex; i < session.messages.length; i += 1) {
        if (session.messages[i].role === "assistant") {
          botMessage = session.messages[i];
          break;
        }
      }
    }

    if (userMessage === undefined) {
      console.error("[Chat] failed to resend", message);
      return;
    }

    // delete the original messages
    deleteMessage(userMessage.id);
    deleteMessage(botMessage?.id);

    // resend the message
    const textContent = getMessageTextContent(userMessage);
    const images = getMessageImages(userMessage);
    if (llm) {
      chatStore.onUserInput(textContent, llm, images);
    }
    inputRef.current?.focus();
  };

  const onChatBodyScroll = (e: HTMLElement) => {
    const bottomHeight = e.scrollTop + e.clientHeight;
    const edgeThreshold = e.clientHeight;

    const isTouchTopEdge = e.scrollTop <= edgeThreshold;
    const isTouchBottomEdge = bottomHeight >= e.scrollHeight - edgeThreshold;
    const isHitBottom =
      bottomHeight >= e.scrollHeight - (isMobileScreen ? 4 : 10);

    const prevPageMsgIndex = msgRenderIndex - CHAT_PAGE_SIZE;
    const nextPageMsgIndex = msgRenderIndex + CHAT_PAGE_SIZE;

    if (isTouchTopEdge && !isTouchBottomEdge) {
      setMsgRenderIndex(prevPageMsgIndex);
    } else if (isTouchBottomEdge) {
      setMsgRenderIndex(nextPageMsgIndex);
    }

    setHitBottom(isHitBottom);
    setAutoScroll(isHitBottom);
  };
  function scrollToBottom() {
    setMsgRenderIndex(renderMessages.length - CHAT_PAGE_SIZE);
    scrollDomToBottom();
  }

  // clear context index = context length + index in messages
  const clearContextIndex =
    (session.clearContextIndex ?? -1) >= 0
      ? session.clearContextIndex! + context.length - msgRenderIndex
      : -1;

  async function uploadImage() {
    const images: ChatImage[] = [];
    images.push(...attachImages);

    images.push(
      ...(await new Promise<ChatImage[]>((res, rej) => {
        const fileInput = document.createElement("input");
        fileInput.type = "file";
        fileInput.accept =
          "image/png, image/jpeg, image/webp, image/heic, image/heif";
        fileInput.multiple = true;
        fileInput.onchange = (event: any) => {
          setUploading(true);
          const files = event.target.files;
          const imagesData: ChatImage[] = [];
          for (let i = 0; i < files.length; i++) {
            const file = event.target.files[i];
            compressImage(file, 256 * 1024)
              .then((imageData) => {
                imagesData.push(imageData);
                if (
                  imagesData.length === 3 ||
                  imagesData.length === files.length
                ) {
                  setUploading(false);
                  res(imagesData);
                }
              })
              .catch((e) => {
                setUploading(false);
                rej(e);
              });
          }
        };
        fileInput.click();
      })),
    );

    const imagesLength = images.length;
    if (imagesLength > 3) {
      images.splice(3, imagesLength - 3);
    }
    setAttachImages(images);
  }

  return (
    <div className={styles.chat} key={session.id}>
      <div className="window-header">
        {isMobileScreen && (
          <div className="window-actions">
            <div className={"window-action-button"}>
              <IconButton
                icon={<ReturnIcon />}
                bordered
                title={Locale.Chat.Actions.ChatList}
                onClick={() => navigate(Path.Home)}
              />
            </div>
          </div>
        )}

        <div className={`window-header-title ${styles["chat-body-title"]}`}>
          <div
            className={`window-header-main-title ${styles["chat-body-main-title"]}`}
            onClickCapture={() => setShowEditPromptModal(true)}
          >
            {!session.topic ? DEFAULT_TOPIC : session.topic}
          </div>
          <div className="window-header-sub-title">
            {Locale.Chat.SubTitle(session.messages.length)}
          </div>
        </div>
        <div className="window-actions">
          {!isMobileScreen && (
            <div className="window-action-button">
              <IconButton
                icon={<RenameIcon />}
                bordered
                onClick={() => setShowEditPromptModal(true)}
              />
            </div>
          )}
          <div className="window-action-button">
            <IconButton
              icon={<ShareIcon />}
              bordered
              title={Locale.Chat.Actions.Share}
              onClick={() => {
                const params = new URLSearchParams({
                  model: config.modelConfig.model,
                  temperature: config.modelConfig.temperature.toString(),
                  top_p: config.modelConfig.top_p.toString(),
                  max_tokens: config.modelConfig.max_tokens.toString(),
                  presence_penalty:
                    config.modelConfig.presence_penalty.toString(),
                  frequency_penalty:
                    config.modelConfig.frequency_penalty.toString(),
                  // template: chatStore.currentSession().template;
                });
                const shareUrl = new URL(
                  `${window.location.origin}${window.location.pathname}?${params}`,
                );
                copyToClipboard(shareUrl.href);
              }}
            />
          </div>
          <div className="window-action-button">
            <IconButton
              icon={<ExportIcon />}
              bordered
              title={Locale.Chat.Actions.Export}
              onClick={() => {
                setShowExport(true);
              }}
            />
          </div>
          {showMaxIcon && (
            <div className="window-action-button">
              <IconButton
                icon={config.tightBorder ? <MinIcon /> : <MaxIcon />}
                bordered
                onClick={() => {
                  config.update(
                    (config) => (config.tightBorder = !config.tightBorder),
                  );
                }}
              />
            </div>
          )}
          <div className="window-action-button">
            <LoginButton />
          </div>
        </div>
      </div>

      <div
        className={styles["chat-body"]}
        ref={scrollRef}
        onScroll={(e) => onChatBodyScroll(e.currentTarget)}
        onMouseDown={() => inputRef.current?.blur()}
        onTouchStart={() => {
          inputRef.current?.blur();
          setAutoScroll(false);
        }}
      >
        <div className={styles["chat-action-context"]}>
          <ChatAction
            text={Locale.Chat.Actions.EditConversation}
            icon={<EditIcon />}
            onClick={() => setShowEditPromptModal(true)}
            fullWidth
          />
        </div>
        {config.modelClientType === ModelClient.HYPHA_AGENT &&
          isConnected &&
          !isAgentReady && (
            <div className={styles["chat-message"]}>
              <div className={styles["chat-message-container"]}>
                <div className={styles["chat-message-header"]}>
                  <div className={styles["chat-message-avatar"]}>
                    <Avatar avatar="2699-fe0f" />
                  </div>
                  <div className={styles["chat-message-role-name"]}>System</div>
                </div>
                <div className={styles["chat-message-item"]}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                    }}
                  >
                    <LoadingIcon />
                    <span>Setting up your AI agent, please wait...</span>
                  </div>
                </div>
              </div>
            </div>
          )}
        {messages.map((message, i) => {
          const isUser = message.role === "user";
          const isContext = i < context.length;
          const showActions =
            i > 0 &&
            !(message.preview || message.content.length === 0) &&
            !isContext;
          const showTyping = message.preview || message.streaming;

          const shouldShowClearContextDivider = i === clearContextIndex - 1;

          return (
            <Fragment key={`${i}/${message.id}`}>
              <div
                className={
                  isUser ? styles["chat-message-user"] : styles["chat-message"]
                }
              >
                <div className={styles["chat-message-container"]}>
                  <div className={styles["chat-message-header"]}>
                    <div className={styles["chat-message-avatar"]}>
                      {!isUser && (
                        <>
                          {["system"].includes(message.role) ? (
                            <Avatar avatar="2699-fe0f" /> // Gear icon
                          ) : (
                            <TemplateAvatar
                              avatar={session.template.avatar}
                              model={message.model || config.modelConfig.model}
                            />
                          )}
                        </>
                      )}
                    </div>
                    <div className={styles["chat-message-role-name-container"]}>
                      {message.role === "system" && (
                        <div
                          className={`${styles["chat-message-role-name"]} ${styles["no-hide"]}`}
                        >
                          {Locale.Chat.Roles.System}
                        </div>
                      )}
                      {message.role === "assistant" && (
                        <div className={styles["chat-message-role-name"]}>
                          {config.modelClientType === ModelClient.HYPHA_AGENT
                            ? config.modelConfig.selectedAgent?.name || ""
                            : models.find((m) => m.name === message.model)
                              ? models.find((m) => m.name === message.model)!
                                  .display_name
                              : message.model}
                        </div>
                      )}
                      {showActions && (
                        <div className={styles["chat-message-actions"]}>
                          <div className={styles["chat-input-actions"]}>
                            <ChatAction
                              text={Locale.Chat.Actions.Edit}
                              icon={<EditIcon />}
                              onClick={async () => {
                                const newMessage = await showPrompt(
                                  Locale.Chat.Actions.Edit,
                                  getMessageTextContent(message),
                                  10,
                                );
                                let newContent: string | MultimodalContent[] =
                                  newMessage;
                                const images = getMessageImages(message);
                                if (images.length > 0) {
                                  newContent = [
                                    { type: "text", text: newMessage },
                                  ];
                                  for (let i = 0; i < images.length; i++) {
                                    newContent.push({
                                      type: "image_url",
                                      image_url: {
                                        url: images[i].url,
                                      },
                                      dimension: {
                                        width: images[i].width,
                                        height: images[i].height,
                                      },
                                    });
                                  }
                                }
                                chatStore.updateCurrentSession((session) => {
                                  const m = session.template.context
                                    .concat(session.messages)
                                    .find((m) => m.id === message.id);
                                  if (m) {
                                    m.content = newContent;
                                  }
                                });
                              }}
                            />
                            {message.streaming ? (
                              <ChatAction
                                text={Locale.Chat.Actions.Stop}
                                icon={<StopIcon />}
                                onClick={() => onUserStop()}
                              />
                            ) : (
                              <>
                                <ChatAction
                                  text={Locale.Chat.Actions.Retry}
                                  icon={<ResetIcon />}
                                  onClick={() => onResend(message)}
                                />

                                <ChatAction
                                  text={Locale.Chat.Actions.Delete}
                                  icon={<DeleteIcon />}
                                  onClick={() => onDelete(message.id ?? i)}
                                />

                                <ChatAction
                                  text={Locale.Chat.Actions.Copy}
                                  icon={<CopyIcon />}
                                  onClick={() =>
                                    copyToClipboard(
                                      getMessageTextContent(message),
                                    )
                                  }
                                />
                              </>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                  {showTyping && (
                    <div className={styles["chat-message-status"]}>
                      {Locale.Chat.Typing}
                    </div>
                  )}
                  <div className={styles["chat-message-item"]}>
                    <Markdown
                      content={getMessageTextContent(message)}
                      loading={
                        (message.preview || message.streaming) &&
                        message.content.length === 0 &&
                        !isUser
                      }
                      onContextMenu={(e) => onRightClick(e, message)}
                      onDoubleClickCapture={() => {
                        if (!isMobileScreen) return;
                        setUserInput(getMessageTextContent(message));
                      }}
                      fontSize={fontSize}
                      parentRef={scrollRef}
                      defaultShow={i >= messages.length - 6}
                    />
                    {getMessageImages(message).length == 1 && (
                      <Image
                        className={styles["chat-message-item-image"]}
                        src={getMessageImages(message)[0].url}
                        width={getMessageImages(message)[0].width}
                        height={getMessageImages(message)[0].height}
                        alt=""
                      />
                    )}
                    {getMessageImages(message).length > 1 && (
                      <div
                        className={styles["chat-message-item-images"]}
                        style={
                          {
                            "--image-count": getMessageImages(message).length,
                          } as React.CSSProperties
                        }
                      >
                        {getMessageImages(message).map((image, index) => {
                          return (
                            <Image
                              className={
                                styles["chat-message-item-image-multi"]
                              }
                              key={index}
                              src={image.url}
                              width={image.width}
                              height={image.height}
                              alt=""
                            />
                          );
                        })}
                      </div>
                    )}
                  </div>
                  <div className={styles["chat-message-action-date"]}>
                    {message.role === "assistant" && message.usage && (
                      <>
                        <div>
                          {`Prefill: ${message.usage.extra.prefill_tokens_per_s.toFixed(
                            1,
                          )} tok/s,`}
                        </div>
                        <div>
                          {`Decode: ${message.usage.extra.decode_tokens_per_s.toFixed(
                            1,
                          )} tok/s,`}
                        </div>
                      </>
                    )}
                    <div>
                      {isContext
                        ? Locale.Chat.IsContext
                        : message.date.toLocaleString()}
                    </div>
                  </div>
                </div>
              </div>
              {shouldShowClearContextDivider && <ClearContextDivider />}
            </Fragment>
          );
        })}
      </div>
      <div className={styles["chat-input-panel"]}>
        <ScrollDownToast onclick={scrollToBottom} show={!hitBottom} />
        <PromptHints prompts={promptHints} onPromptSelect={onPromptSelect} />

        {/* Warning for non-authenticated users */}
        {config.modelClientType === ModelClient.HYPHA_AGENT && !isConnected && (
          <div className={styles["login-warning"]}>
            <div className={styles["login-warning-content"]}>
              <svg
                className={styles["login-warning-icon"]}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.728-.833-2.498 0L4.316 16.5c-.77.833.192 2.5 1.732 2.5z"
                />
              </svg>
              <div className={styles["login-warning-text"]}>
                <strong>Please log in to chat with AI agents</strong>
                <p>
                  You need to authenticate with the Hypha server to use the chat
                  functionality.
                </p>
              </div>
            </div>
          </div>
        )}

        <ChatActions
          uploadImage={uploadImage}
          setAttachImages={setAttachImages}
          setUploading={setUploading}
          scrollToBottom={scrollToBottom}
          hitBottom={hitBottom}
          uploading={uploading}
          showPromptSetting={() => setShowEditPromptModal(true)}
          showPromptHints={() => {
            // Click again to close
            if (promptHints.length > 0) {
              setPromptHints([]);
              return;
            }

            inputRef.current?.focus();
            setUserInput("/");
            onSearch("");
          }}
        />
        <label
          className={`${styles["chat-input-panel-inner"]} ${
            attachImages.length != 0
              ? styles["chat-input-panel-inner-attach"]
              : ""
          }`}
          htmlFor="chat-input"
        >
          <textarea
            id="chat-input"
            ref={inputRef}
            className={styles["chat-input"]}
            placeholder={
              config.modelClientType === ModelClient.HYPHA_AGENT &&
              !isAgentReady
                ? "Setting up agent, please wait..."
                : Locale.Chat.Input(submitKey)
            }
            onInput={(e) => onInput(e.currentTarget.value)}
            value={userInput}
            onKeyDown={onInputKeyDown}
            onFocus={scrollToBottom}
            onClick={scrollToBottom}
            onPaste={handlePaste}
            rows={inputRows}
            autoFocus={autoFocus}
            disabled={
              config.modelClientType === ModelClient.HYPHA_AGENT &&
              !isAgentReady
            }
            style={{
              fontSize: config.fontSize,
              opacity:
                config.modelClientType === ModelClient.HYPHA_AGENT &&
                !isAgentReady
                  ? 0.6
                  : 1,
            }}
          />
          {attachImages.length != 0 && (
            <div className={styles["attach-images"]}>
              {attachImages.map((image, index) => {
                return (
                  <div
                    key={index}
                    className={styles["attach-image"]}
                    style={{ backgroundImage: `url("${image.url}")` }}
                  >
                    <div className={styles["attach-image-template"]}>
                      <DeleteImageButton
                        deleteImage={() => {
                          setAttachImages(
                            attachImages.filter((_, i) => i !== index),
                          );
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {isStreaming ? (
            <IconButton
              icon={<StopIcon />}
              text={Locale.Chat.InputActions.Stop}
              className={styles["chat-input-send"]}
              type="primary"
              onClick={() => onUserStop()}
            />
          ) : (
            <IconButton
              icon={<SendWhiteIcon />}
              text={Locale.Chat.Send}
              className={styles["chat-input-send"]}
              type="primary"
              disabled={
                config.modelClientType === ModelClient.HYPHA_AGENT &&
                !isAgentReady
              }
              onClick={() => onSubmit(userInput)}
            />
          )}
        </label>
      </div>

      {showExport && (
        <ExportMessageModal onClose={() => setShowExport(false)} />
      )}

      {showEditPromptModal && (
        <SessionConfigModel onClose={() => setShowEditPromptModal(false)} />
      )}
    </div>
  );
}

export function Chat() {
  const chatStore = useChatStore();
  const sessionIndex = chatStore.currentSessionIndex;
  return <_Chat key={sessionIndex}></_Chat>;
}
