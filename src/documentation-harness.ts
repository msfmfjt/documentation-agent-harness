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
  readonly templatePath?: string;
  readonly draftPath?: string;
  readonly thinkingLevel?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
}

export interface DocumentationHarnessResult {
  readonly sessionId: string;
  readonly sessionFile?: string;
}

export async function runInteractiveDocumentationHarness(
  options: DocumentationHarnessOptions,
): Promise<DocumentationHarnessResult> {
  const modelRuntime = await ModelRuntime.create();
  const settingsManager = SettingsManager.inMemory({
    compaction: { enabled: true },
    retry: { enabled: true, maxRetries: 2 },
  });

  const loader = new DefaultResourceLoader({
    agentDir: getAgentDir(),
    cwd: options.workspacePath,
    settingsManager,
    systemPromptOverride: () => documentationSystemPrompt,
  });
  await loader.reload();

  const { session } = await createAgentSession({
    cwd: options.workspacePath,
    modelRuntime,
    resourceLoader: loader,
    sessionManager: SessionManager.inMemory(options.workspacePath),
    settingsManager,
    thinkingLevel: options.thinkingLevel ?? "medium",
    tools: ["read", "write", "edit"],
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
