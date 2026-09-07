import { mkdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { buildInitialDocumentationPrompt, documentationSystemPrompt, } from "./prompts.js";
export async function runInteractiveCopilotDocumentationHarness(options) {
    await mkdir(options.outputDir, { recursive: true });
    logVerbose(options, "Starting Copilot documentation harness");
    logVerbose(options, `Workspace: ${options.workspacePath}`);
    logVerbose(options, `Output directory: ${options.outputDir}`);
    logVerbose(options, `Model: ${options.copilotModel ?? "auto"}`);
    logVerboseList(options, "References", options.referencePaths);
    const { CopilotClient } = await import("@github/copilot-sdk");
    const client = new CopilotClient({
        logLevel: options.verbose ? "debug" : undefined,
        mode: "empty",
        workingDirectory: options.workspacePath,
    });
    const writeDocument = createCopilotWriteDocumentTool(options.outputDir);
    await client.start();
    const session = await client.createSession({
        availableTools: ["custom:write_document"],
        clientName: "documentation-agent-harness",
        model: options.copilotModel,
        streaming: true,
        systemMessage: {
            mode: "append",
            content: documentationSystemPrompt,
        },
        tools: [writeDocument],
        workingDirectory: options.workspacePath,
    });
    const unsubscribeMessage = session.on("assistant.message_delta", (event) => {
        process.stdout.write(event.data.deltaContent);
    });
    const unsubscribeError = session.on("session.error", (event) => {
        process.stderr.write(`\n[session error] ${event.data.message}\n`);
    });
    const terminal = createInterface({ input, output });
    try {
        await session.sendAndWait({
            prompt: buildInitialDocumentationPrompt(options),
            attachments: buildAttachments(options),
        });
        while (true) {
            const userInput = await terminal.question("\n\nYou: ");
            const normalizedInput = userInput.trim();
            if (normalizedInput === "/exit" || normalizedInput === "/quit") {
                break;
            }
            if (normalizedInput.length === 0) {
                continue;
            }
            await session.sendAndWait({ prompt: normalizedInput });
        }
        return {
            sessionId: session.sessionId,
        };
    }
    finally {
        terminal.close();
        unsubscribeError();
        unsubscribeMessage();
        await session.disconnect();
        await client.stop();
    }
}
function createCopilotWriteDocumentTool(outputDir) {
    return {
        name: "write_document",
        description: "Create or overwrite a documentation output file. The path must be relative to the configured documentation output directory.",
        defer: "never",
        parameters: {
            type: "object",
            properties: {
                path: {
                    type: "string",
                    description: "Path relative to the documentation output directory.",
                },
                content: {
                    type: "string",
                    description: "Complete file content to write.",
                },
            },
            required: ["path", "content"],
            additionalProperties: false,
        },
        skipPermission: true,
        handler: async (args) => {
            const { path, content } = args;
            const targetPath = path.trim();
            if (!targetPath) {
                return writeDocumentFailure("Document path must not be empty.");
            }
            if (isAbsolute(targetPath)) {
                return writeDocumentFailure("Document path must be relative to the output directory.");
            }
            const resolvedOutputDir = resolve(outputDir);
            const resolvedTarget = resolve(resolvedOutputDir, targetPath);
            const relativeTarget = relative(resolvedOutputDir, resolvedTarget);
            if (relativeTarget.startsWith("..") || isAbsolute(relativeTarget)) {
                return writeDocumentFailure("Document path must stay inside the output directory.");
            }
            await mkdir(dirname(resolvedTarget), { recursive: true });
            await writeFile(resolvedTarget, content, "utf8");
            return {
                resultType: "success",
                textResultForLlm: `Successfully wrote ${content.length} bytes to ${relativeTarget}`,
            };
        },
    };
}
function buildAttachments(options) {
    const paths = [
        options.templatePath,
        ...options.referencePaths,
        options.draftPath,
    ].filter((path) => Boolean(path));
    return paths.map((path) => ({
        type: "file",
        path,
        displayName: relative(options.workspacePath, path),
    }));
}
function writeDocumentFailure(message) {
    return {
        error: message,
        resultType: "failure",
        textResultForLlm: message,
    };
}
function logVerbose(options, message) {
    if (options.verbose) {
        process.stderr.write(`[verbose] ${message}\n`);
    }
}
function logVerboseList(options, label, values) {
    if (!options.verbose) {
        return;
    }
    process.stderr.write(`[verbose] ${label}: ${values.length}\n`);
    for (const value of values) {
        process.stderr.write(`[verbose]   - ${value}\n`);
    }
}
