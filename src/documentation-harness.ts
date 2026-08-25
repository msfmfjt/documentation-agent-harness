import {
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import {
  buildInitialDocumentationPrompt,
  documentationSystemPrompt,
  type DocumentationMode,
} from "./prompts.js";

export interface DocumentationHarnessOptions {
  readonly workspacePath: string;
  readonly outputDir: string;
  readonly mode: DocumentationMode;
  readonly audience: string;
  readonly referencePaths: readonly string[];
  readonly extensionPaths: readonly string[];
  readonly enabledTools: readonly string[];
  readonly templatePath?: string;
  readonly draftPath?: string;
  readonly authPath?: string;
  readonly modelsPath?: string;
  readonly model?: {
    readonly provider: string;
    readonly id: string;
  };
  readonly thinkingLevel?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
}

export interface DocumentationHarnessResult {
  readonly sessionId: string;
  readonly sessionFile?: string;
}

export async function runInteractiveDocumentationHarness(
  options: DocumentationHarnessOptions,
): Promise<DocumentationHarnessResult> {
  const modelRuntime = await ModelRuntime.create({
    authPath: options.authPath,
    modelsPath: options.modelsPath,
  });
  const settingsManager = SettingsManager.inMemory({
    compaction: { enabled: true },
    retry: { enabled: true, maxRetries: 2 },
  });

  const initialModel = options.model
    ? modelRuntime.getModel(options.model.provider, options.model.id)
    : undefined;

  const loader = new DefaultResourceLoader({
    agentDir: getAgentDir(),
    additionalExtensionPaths: [...options.extensionPaths],
    cwd: options.workspacePath,
    settingsManager,
    systemPromptOverride: () => documentationSystemPrompt,
  });
  await loader.reload();

  const { session } = await createAgentSession({
    cwd: options.workspacePath,
    model: initialModel,
    modelRuntime,
    resourceLoader: loader,
    sessionManager: SessionManager.inMemory(options.workspacePath),
    settingsManager,
    thinkingLevel: options.thinkingLevel ?? "medium",
    tools: [...new Set(["read", "write", "edit", ...options.enabledTools])],
  });

  const unsubscribe = session.subscribe((event) => {
    if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
      process.stdout.write(event.assistantMessageEvent.delta);
    }
    if (event.type === "tool_execution_start") {
      process.stderr.write(`\n[tool] ${event.toolName}\n`);
    }
  });

  const terminal = createInterface({ input, output });

  try {
    if (options.model) {
      const selectedModel = modelRuntime.getModel(options.model.provider, options.model.id);
      if (!selectedModel) {
        throw new Error(`Model not found: ${options.model.provider}/${options.model.id}`);
      }
      await session.setModel(selectedModel);
    }

    await session.prompt(buildInitialDocumentationPrompt(options));

    while (true) {
      const userInput = await terminal.question("\n\nYou: ");
      const normalizedInput = userInput.trim();
      if (normalizedInput === "/exit" || normalizedInput === "/quit") {
        break;
      }
      if (normalizedInput.length === 0) {
        continue;
      }
      await session.prompt(normalizedInput);
    }

    return {
      sessionFile: session.sessionFile,
      sessionId: session.sessionId,
    };
  } finally {
    terminal.close();
    unsubscribe();
    session.dispose();
  }
}
