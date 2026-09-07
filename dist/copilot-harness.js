import { access, mkdir, writeFile } from "node:fs/promises";
import { dirname, join, isAbsolute, relative, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { buildInitialDocumentationPrompt, documentationSystemPrompt, } from "./prompts.js";
export async function runInteractiveCopilotDocumentationHarness(options) {
    await mkdir(options.outputDir, { recursive: true });
    logVerbose(options, "Starting Copilot documentation harness");
    logVerbose(options, `Workspace: ${options.workspacePath}`);
    logVerbose(options, `Output directory: ${options.outputDir}`);
    logVerbose(options, `Model: ${options.copilotModel ?? "auto"}`);
    logVerboseList(options, "References", options.referencePaths);
    const { CopilotClient, RuntimeConnection } = await import("@github/copilot-sdk");
    const copilotCliPath = await resolveCopilotCliPath(options.copilotCliPath);
    const baseDirectory = getCopilotBaseDirectory(options.copilotHome);
    logVerbose(options, `Copilot CLI path: ${copilotCliPath}`);
    logVerbose(options, `Copilot base directory: ${baseDirectory}`);
    const client = new CopilotClient({
        baseDirectory,
        connection: RuntimeConnection.forStdio({ path: copilotCliPath }),
        logLevel: options.verbose ? "debug" : undefined,
        mode: "empty",
        workingDirectory: options.workspacePath,
    });
    const writeDocument = createCopilotWriteDocumentTool(options.outputDir);
    await client.start();
    try {
        if (options.verbose) {
            await logCopilotRuntimeDiagnostics(client);
        }
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
        }
    }
    finally {
        await client.stop();
    }
}
function getCopilotBaseDirectory(explicitHome) {
    return explicitHome ?? resolve(homedir(), ".copilot");
}
async function resolveCopilotCliPath(explicitPath) {
    if (explicitPath) {
        return explicitPath;
    }
    for (const packageName of getCopilotPlatformPackageNames()) {
        const packageRoot = await resolvePackageRoot(packageName);
        if (!packageRoot) {
            continue;
        }
        for (const candidate of [
            join(packageRoot, "index.js"),
            join(packageRoot, "npm-loader.js"),
        ]) {
            if (await canRead(candidate)) {
                return candidate;
            }
        }
    }
    return "copilot";
}
function getCopilotPlatformPackageNames() {
    const variants = process.platform === "linux" ? ["linux", "linuxmusl"] : [process.platform];
    return variants.map((variant) => `@github/copilot-${variant}-${process.arch}`);
}
async function resolvePackageRoot(packageName) {
    try {
        const entryPath = fileURLToPath(import.meta.resolve(packageName));
        return dirname(entryPath);
    }
    catch {
        return undefined;
    }
}
async function canRead(path) {
    try {
        await access(path);
        return true;
    }
    catch {
        return false;
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
async function logCopilotRuntimeDiagnostics(client) {
    try {
        const authStatus = await client.getAuthStatus();
        logVerboseValue("Copilot auth authenticated", authStatus.isAuthenticated);
        logVerboseValue("Copilot auth type", authStatus.authType ?? "unknown");
        logVerboseValue("Copilot auth host", authStatus.host ?? "unknown");
        logVerboseValue("Copilot auth login", authStatus.login ?? "unknown");
        if (authStatus.statusMessage) {
            logVerboseValue("Copilot auth status", authStatus.statusMessage);
        }
    }
    catch (error) {
        logVerboseValue("Copilot auth status error", getErrorMessage(error));
    }
    try {
        const models = await client.listModels();
        logVerboseValue("Copilot model count", models.length);
    }
    catch (error) {
        logVerboseValue("Copilot model list error", getErrorMessage(error));
    }
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
function logVerboseValue(label, value) {
    process.stderr.write(`[verbose] ${label}: ${String(value)}\n`);
}
function getErrorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}
