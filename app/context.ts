import { createContext } from "react";
import { WebLLMApi } from "./client/webllm";
import { ModelRecord } from "./client/api";
import { MlcLLMApi } from "./client/mlcllm";
import { HyphaAgentApi } from "./client/hypha-agent";

export const WebLLMContext = createContext<WebLLMApi | undefined>(undefined);
export const MLCLLMContext = createContext<MlcLLMApi | undefined>(undefined);
export const HyphaAgentContext = createContext<HyphaAgentApi | undefined>(
  undefined,
);
