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
  readonly verbose: boolean;
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
  logVerbose(options, "Starting documentation harness");
  logVerbose(options, `Workspace: ${options.workspacePath}`);
  logVerbose(options, `Output directory: ${options.outputDir}`);
  logVerbose(options, `Template: ${options.templatePath ?? "(none)"}`);
  logVerbose(options, `Draft: ${options.draftPath ?? "(none)"}`);
  logVerboseList(options, "References", options.referencePaths);
  logVerboseList(options, "Extensions", options.extensionPaths);
  logVerboseList(options, "Enabled tools", ["read", "write", "edit", ...options.enabledTools]);
  logVerbose(options, `Models file: ${options.modelsPath ?? "(default)"}`);
  logVerbose(options, `Auth file: ${options.authPath ?? "(default)"}`);
  logVerbose(
    options,
    `Requested model: ${options.model ? `${options.model.provider}/${options.model.id}` : "(default)"}`,
  );

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
  if (options.model && !initialModel) {
    logVerbose(
      options,
      "Requested model was not found before extension loading. It will be resolved again after session startup.",
    );
  }
  logVerboseList(options, "Providers before extension loading", modelRuntime.getRegisteredProviderIds());

  const loader = new DefaultResourceLoader({
    agentDir: getAgentDir(),
    additionalExtensionPaths: [...options.extensionPaths],
    cwd: options.workspacePath,
    settingsManager,
    systemPromptOverride: () => documentationSystemPrompt,
  });
  await loader.reload();
  const extensionsResult = loader.getExtensions();
  logVerbose(
    options,
    `Loaded extensions: ${extensionsResult.extensions.length}`,
  );
  for (const extension of extensionsResult.extensions) {
    logVerbose(options, `  - ${extension.resolvedPath}`);
  }
  if (extensionsResult.errors.length > 0) {
    logVerbose(options, `Extension load errors: ${extensionsResult.errors.length}`);
    for (const error of extensionsResult.errors) {
      logVerbose(options, `  - ${error.path}: ${error.error}`);
    }
  }

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
  logVerboseList(options, "Providers after session startup", modelRuntime.getRegisteredProviderIds());
  logVerboseList(
    options,
    "Models after session startup",
    modelRuntime.getModels().map((model) => `${model.provider}/${model.id}`),
  );

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
      logVerbose(options, `Selected model: ${selectedModel.provider}/${selectedModel.id}`);
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

function logVerbose(options: DocumentationHarnessOptions, message: string): void {
  if (options.verbose) {
    process.stderr.write(`[verbose] ${message}\n`);
  }
}

function logVerboseList(
  options: DocumentationHarnessOptions,
  label: string,
  values: readonly string[],
): void {
  if (!options.verbose) {
    return;
  }

  process.stderr.write(`[verbose] ${label}: ${values.length}\n`);
  for (const value of values) {
    process.stderr.write(`[verbose]   - ${value}\n`);
  }
}
