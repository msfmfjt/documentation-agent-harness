import {
  createAgentSession,
  createWriteToolDefinition,
  DefaultResourceLoader,
  defineTool,
  getAgentDir,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import {
  buildInitialDocumentationPrompt,
  documentationSystemPrompt,
  type DocumentationMode,
} from "./prompts.js";

export interface DocumentationHarnessOptions {
  readonly runtime: "pi" | "copilot";
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
  readonly copilotCliPath?: string;
  readonly copilotHome?: string;
  readonly copilotGithubTokenEnv?: string;
  readonly sessionDir?: string;
  readonly sessionFile?: string;
  readonly persistSession: boolean;
  readonly resume: boolean;
  readonly verbose: boolean;
  readonly model?: {
    readonly provider: string;
    readonly id: string;
  };
  readonly copilotModel?: string;
  readonly providedOptions: readonly string[];
  readonly thinkingLevel?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
}

export interface DocumentationHarnessResult {
  readonly sessionId: string;
  readonly sessionFile?: string;
}

export async function runInteractiveDocumentationHarness(
  initialOptions: DocumentationHarnessOptions,
): Promise<DocumentationHarnessResult> {
  const initialSessionManager = createSessionManager(initialOptions);
  const options = await hydrateOptionsFromSessionMetadata(initialOptions, initialSessionManager);
  await mkdir(options.outputDir, { recursive: true });

  logVerbose(options, "Starting documentation harness");
  logVerbose(options, `Workspace: ${options.workspacePath}`);
  logVerbose(options, `Output directory: ${options.outputDir}`);
  logVerbose(options, `Template: ${options.templatePath ?? "(none)"}`);
  logVerbose(options, `Draft: ${options.draftPath ?? "(none)"}`);
  logVerboseList(options, "References", options.referencePaths);
  logVerboseList(options, "Extensions", options.extensionPaths);
  const documentWriteTool = createDocumentWriteTool(options.outputDir);
  const activeTools = [...new Set(["read", "edit", documentWriteTool.name, ...options.enabledTools])];
  logVerboseList(options, "Enabled tools", activeTools);
  logVerbose(options, `Models file: ${options.modelsPath ?? "(default)"}`);
  logVerbose(options, `Auth file: ${options.authPath ?? "(default)"}`);
  logVerbose(options, `Session mode: ${describeSessionMode(options)}`);
  logVerbose(options, `Session dir: ${options.sessionDir ?? "(default)"}`);
  logVerbose(options, `Session file: ${options.sessionFile ?? "(none)"}`);
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

  const sessionManager = initialSessionManager;
  logVerbose(options, `Resolved session file: ${sessionManager.getSessionFile() ?? "(none)"}`);
  await tryWriteSessionMetadata(options, sessionManager);

  const { session } = await createAgentSession({
    cwd: options.workspacePath,
    model: initialModel,
    modelRuntime,
    resourceLoader: loader,
    sessionManager,
    settingsManager,
    thinkingLevel: options.thinkingLevel ?? "medium",
    tools: activeTools,
    customTools: [documentWriteTool],
  });
  logVerboseList(options, "Providers after session startup", modelRuntime.getRegisteredProviderIds());
  logVerboseList(
    options,
    "Models after session startup",
    modelRuntime.getModels().map((model) => `${model.provider}/${model.id}`),
  );
  logVerboseProviderDiagnostics(options, modelRuntime);

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
    await tryWriteSessionMetadata(options, sessionManager);
    terminal.close();
    unsubscribe();
    session.dispose();
  }
}

function createDocumentWriteTool(outputDir: string): ToolDefinition {
  const baseTool = createWriteToolDefinition(outputDir);

  return defineTool({
    ...baseTool,
    name: "write_document",
    label: "write document",
    description:
      "Create or overwrite a documentation output file. The path must be relative to the configured documentation output directory.",
    promptSnippet: "Create or overwrite documentation files inside the configured output directory",
    promptGuidelines: [
      "Use write_document for final documentation output files.",
      "Pass a path relative to the documentation output directory.",
      "Do not pass absolute paths or paths that leave the documentation output directory.",
    ],
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const targetPath = params.path.trim();
      if (!targetPath) {
        return documentWriteError("Document path must not be empty.");
      }
      if (isAbsolute(targetPath)) {
        return documentWriteError("Document path must be relative to the output directory.");
      }

      const resolvedOutputDir = resolve(outputDir);
      const resolvedTarget = resolve(resolvedOutputDir, targetPath);
      const relativeTarget = relative(resolvedOutputDir, resolvedTarget);
      if (relativeTarget.startsWith("..") || isAbsolute(relativeTarget)) {
        return documentWriteError("Document path must stay inside the output directory.");
      }

      return baseTool.execute(toolCallId, params, signal, onUpdate, ctx);
    },
  });
}

function documentWriteError(message: string) {
  return {
    content: [{ type: "text" as const, text: message }],
    details: undefined,
    isError: true,
  };
}

interface SessionMetadata {
  readonly version: 1;
  readonly savedAt: string;
  readonly options: SessionMetadataOptions;
}

type SessionMetadataOptions = Pick<
  DocumentationHarnessOptions,
  | "workspacePath"
  | "runtime"
  | "outputDir"
  | "mode"
  | "audience"
  | "referencePaths"
  | "extensionPaths"
  | "enabledTools"
  | "templatePath"
  | "draftPath"
  | "modelsPath"
  | "sessionDir"
  | "model"
  | "copilotModel"
>;

async function hydrateOptionsFromSessionMetadata(
  options: DocumentationHarnessOptions,
  sessionManager: SessionManager,
): Promise<DocumentationHarnessOptions> {
  if (!options.resume && !options.sessionFile) {
    return options;
  }

  const metadata = await readSessionMetadata(sessionManager);
  if (!metadata) {
    logVerbose(options, "No session metadata found to hydrate resume options.");
    return options;
  }

  const providedOptions = new Set(options.providedOptions);
  const saved = metadata.options;

  return {
    ...options,
    runtime: providedOptions.has("runtime") ? options.runtime : (saved.runtime ?? "pi"),
    outputDir: providedOptions.has("output") ? options.outputDir : saved.outputDir,
    mode: providedOptions.has("mode") ? options.mode : saved.mode,
    audience: providedOptions.has("audience") ? options.audience : saved.audience,
    referencePaths:
      providedOptions.has("reference") || providedOptions.has("reference-dir")
        ? options.referencePaths
        : saved.referencePaths,
    extensionPaths: providedOptions.has("extension") ? options.extensionPaths : saved.extensionPaths,
    enabledTools: providedOptions.has("tool") ? options.enabledTools : saved.enabledTools,
    templatePath: providedOptions.has("template") ? options.templatePath : saved.templatePath,
    draftPath: providedOptions.has("draft") ? options.draftPath : saved.draftPath,
    modelsPath: providedOptions.has("models-file") ? options.modelsPath : saved.modelsPath,
    sessionDir: providedOptions.has("session-dir") ? options.sessionDir : saved.sessionDir,
    model: providedOptions.has("model") ? options.model : saved.model,
    copilotModel: providedOptions.has("model") ? options.copilotModel : saved.copilotModel,
  };
}

async function readSessionMetadata(
  sessionManager: SessionManager,
): Promise<SessionMetadata | undefined> {
  const sessionFile = sessionManager.getSessionFile();
  if (!sessionFile) {
    return undefined;
  }

  try {
    const content = await readFile(getSessionMetadataPath(sessionFile), "utf8");
    const parsed = JSON.parse(content) as SessionMetadata;
    return parsed.version === 1 ? parsed : undefined;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

async function writeSessionMetadata(
  options: DocumentationHarnessOptions,
  sessionManager: SessionManager,
): Promise<void> {
  const sessionFile = sessionManager.getSessionFile();
  if (!sessionFile || !sessionManager.isPersisted()) {
    return;
  }

  const metadata: SessionMetadata = {
    version: 1,
    savedAt: new Date().toISOString(),
    options: {
      workspacePath: options.workspacePath,
      runtime: options.runtime,
      outputDir: options.outputDir,
      mode: options.mode,
      audience: options.audience,
      referencePaths: options.referencePaths,
      extensionPaths: options.extensionPaths,
      enabledTools: options.enabledTools,
      templatePath: options.templatePath,
      draftPath: options.draftPath,
      modelsPath: options.modelsPath,
      sessionDir: options.sessionDir,
      model: options.model,
      copilotModel: options.copilotModel,
    },
  };

  await writeFile(getSessionMetadataPath(sessionFile), `${JSON.stringify(metadata, null, 2)}\n`);
}

async function tryWriteSessionMetadata(
  options: DocumentationHarnessOptions,
  sessionManager: SessionManager,
): Promise<void> {
  try {
    await writeSessionMetadata(options, sessionManager);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Warning: Could not write session metadata: ${message}\n`);
  }
}

function getSessionMetadataPath(sessionFile: string): string {
  return `${sessionFile}.doc-harness.json`;
}

function createSessionManager(options: DocumentationHarnessOptions): SessionManager {
  if (options.sessionFile) {
    return SessionManager.open(options.sessionFile, options.sessionDir, options.workspacePath);
  }

  if (options.resume) {
    return SessionManager.continueRecent(options.workspacePath, options.sessionDir);
  }

  if (options.persistSession) {
    return SessionManager.create(options.workspacePath, options.sessionDir);
  }

  return SessionManager.inMemory(options.workspacePath);
}

function describeSessionMode(options: DocumentationHarnessOptions): string {
  if (options.sessionFile) {
    return "session-file";
  }
  if (options.resume) {
    return "resume";
  }
  if (options.persistSession) {
    return "persistent";
  }
  return "in-memory";
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

function logVerboseProviderDiagnostics(
  options: DocumentationHarnessOptions,
  modelRuntime: ModelRuntime,
): void {
  if (!options.verbose) {
    return;
  }

  const providerIds = modelRuntime.getRegisteredProviderIds();
  for (const providerId of providerIds) {
    const models = modelRuntime.getModels(providerId);
    process.stderr.write(`[verbose] Provider ${providerId} model count: ${models.length}\n`);
    const config = modelRuntime.getRegisteredProviderConfig(providerId);
    if (config && "models" in config && Array.isArray(config.models)) {
      process.stderr.write(
        `[verbose] Provider ${providerId} registered config model count: ${config.models.length}\n`,
      );
    }
  }

  if (!options.model) {
    return;
  }

  const requestedProviderModels = modelRuntime.getModels(options.model.provider);
  if (requestedProviderModels.length === 0 && providerIds.includes(options.model.provider)) {
    process.stderr.write(
      `[verbose] Requested provider ${options.model.provider} is registered, but it has no models. If the extension discovers models dynamically, fetch and register them in the async extension factory instead of a session_start handler.\n`,
    );
  }

  const requestedModel = modelRuntime.getModel(options.model.provider, options.model.id);
  if (!requestedModel) {
    process.stderr.write(
      `[verbose] Requested model ${options.model.provider}/${options.model.id} is not registered.\n`,
    );
  }
}
