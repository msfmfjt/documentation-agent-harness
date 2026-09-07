import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, isAbsolute, relative, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { buildInitialDocumentationPrompt, documentationSystemPrompt, } from "./prompts.js";
import { appendDecisionLogEntry } from "./decision-log.js";
export async function runInteractiveCopilotDocumentationHarness(options) {
    await mkdir(options.outputDir, { recursive: true });
    logVerbose(options, "Starting Copilot documentation harness");
    logVerbose(options, `Workspace: ${options.workspacePath}`);
    logVerbose(options, `Output directory: ${options.outputDir}`);
    logVerbose(options, `Decision log: ${options.decisionLogPath ?? "(disabled)"}`);
    logVerbose(options, `Model: ${options.copilotModel ?? "auto"}`);
    logVerboseList(options, "References", options.referencePaths);
    const { CopilotClient, RuntimeConnection } = await import("@github/copilot-sdk");
    const copilotCliPath = await resolveCopilotCliPath(options.copilotCliPath);
    const baseDirectory = getCopilotBaseDirectory(options.copilotHome);
    const githubToken = getGithubTokenFromEnvironment(options.copilotGithubTokenEnv);
    logVerbose(options, `Copilot CLI path: ${copilotCliPath}`);
    logVerbose(options, `Copilot base directory: ${baseDirectory}`);
    logVerbose(options, `Copilot GitHub token env: ${options.copilotGithubTokenEnv ? `${options.copilotGithubTokenEnv} (${githubToken ? "set" : "unset"})` : "(none)"}`);
    const client = new CopilotClient({
        baseDirectory,
        connection: RuntimeConnection.forStdio({ path: copilotCliPath }),
        gitHubToken: githubToken,
        logLevel: options.verbose ? "debug" : undefined,
        mode: "empty",
        workingDirectory: options.workspacePath,
    });
    const readableDocuments = createReadableDocumentRegistry(options);
    const listDocuments = createCopilotListDocumentsTool(readableDocuments);
    const readDocument = createCopilotReadDocumentTool(options, readableDocuments);
    const recordDecision = options.decisionLogPath
        ? createCopilotRecordDecisionTool(options.decisionLogPath)
        : undefined;
    const writeDocument = createCopilotWriteDocumentTool(options.outputDir);
    const tools = [listDocuments, readDocument, ...(recordDecision ? [recordDecision] : []), writeDocument];
    await client.start();
    try {
        const models = await logCopilotRuntimeDiagnostics(client, options.verbose);
        assertCopilotModelAvailable(options.copilotModel, models);
        const session = await client.createSession({
            availableTools: tools.map((tool) => `custom:${tool.name}`),
            clientName: "documentation-agent-harness",
            model: options.copilotModel,
            streaming: true,
            systemMessage: {
                mode: "append",
                content: documentationSystemPrompt,
            },
            tools,
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
function getGithubTokenFromEnvironment(envName) {
    if (!envName) {
        return undefined;
    }
    const token = process.env[envName];
    return token && token.trim().length > 0 ? token : undefined;
}
function createReadableDocumentRegistry(options) {
    const documents = [];
    if (options.templatePath) {
        documents.push({
            path: options.templatePath,
            displayName: relative(options.workspacePath, options.templatePath),
            kind: "template",
        });
    }
    for (const referencePath of options.referencePaths) {
        documents.push({
            path: referencePath,
            displayName: relative(options.workspacePath, referencePath),
            kind: "reference",
        });
    }
    if (options.draftPath) {
        documents.push({
            path: options.draftPath,
            displayName: relative(options.workspacePath, options.draftPath),
            kind: "draft",
        });
    }
    return documents;
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
function createCopilotListDocumentsTool(readableDocuments) {
    return {
        name: "list_documents",
        description: "List the template, reference, and draft documents that this documentation session is allowed to read.",
        defer: "never",
        parameters: {
            type: "object",
            properties: {},
            additionalProperties: false,
        },
        skipPermission: true,
        handler: () => ({
            resultType: "success",
            textResultForLlm: readableDocuments.length > 0
                ? readableDocuments
                    .map((document) => `- ${document.displayName} (${document.kind})`)
                    .join("\n")
                : "No readable template, reference, or draft documents were provided.",
        }),
    };
}
function createCopilotReadDocumentTool(options, readableDocuments) {
    return {
        name: "read_document",
        description: "Read a provided template, reference, draft, or generated documentation file by line range. Source code files are not readable through this tool.",
        defer: "never",
        parameters: {
            type: "object",
            properties: {
                path: {
                    type: "string",
                    description: "Document path to read. Use a path shown by list_documents, or a path relative to the documentation output directory for generated files.",
                },
                startLine: {
                    type: "number",
                    description: "One-based line number to start reading from. Defaults to 1.",
                },
                lineCount: {
                    type: "number",
                    description: "Number of lines to read. Defaults to 200 and is capped at 400.",
                },
            },
            required: ["path"],
            additionalProperties: false,
        },
        skipPermission: true,
        handler: async (args) => {
            const resolvedPath = resolveReadableDocumentPath(args.path, options, readableDocuments);
            if (!resolvedPath) {
                return documentToolFailure("Document path is not readable. Use list_documents, or read a file inside the documentation output directory.");
            }
            try {
                const content = await readFile(resolvedPath, "utf8");
                const lineRange = getLineRange(args);
                const formattedContent = formatDocumentLineRange(content, lineRange.startLine, lineRange.lineCount);
                return {
                    resultType: "success",
                    textResultForLlm: formattedContent,
                };
            }
            catch (error) {
                return documentToolFailure(`Could not read document: ${getErrorMessage(error)}`);
            }
        },
    };
}
function getLineRange(args) {
    const startLine = Number.isFinite(args.startLine) && args.startLine ? Math.max(1, Math.floor(args.startLine)) : 1;
    const requestedLineCount = Number.isFinite(args.lineCount) && args.lineCount ? Math.max(1, Math.floor(args.lineCount)) : 200;
    return {
        startLine,
        lineCount: Math.min(requestedLineCount, 400),
    };
}
function formatDocumentLineRange(content, startLine, lineCount) {
    const lines = content.split(/\r?\n/);
    const startIndex = Math.max(0, startLine - 1);
    const selectedLines = lines.slice(startIndex, startIndex + lineCount);
    const endLine = selectedLines.length === 0 ? startLine - 1 : startLine + selectedLines.length - 1;
    const header = [
        `Lines ${startLine}-${endLine} of ${lines.length}.`,
        endLine < lines.length ? `More content is available from startLine ${endLine + 1}.` : "End of document.",
        "",
    ];
    const body = selectedLines.map((line, index) => `${startLine + index}: ${line}`);
    return [...header, ...body].join("\n");
}
function createCopilotRecordDecisionTool(decisionLogPath) {
    return {
        name: "record_decision",
        description: "Append a concise documentation decision, assumption, open question, or approved direction to the session decision log.",
        defer: "never",
        parameters: {
            type: "object",
            properties: {
                section: {
                    type: "string",
                    description: "Document section or topic this decision belongs to.",
                },
                decision: {
                    type: "string",
                    description: "The concise decision, assumption, open question, or approved direction to record.",
                },
                rationale: {
                    type: "string",
                    description: "Brief reason for the decision.",
                },
                source: {
                    type: "string",
                    description: "Reference document, user feedback, or conversation source that supports the decision.",
                },
                status: {
                    type: "string",
                    description: "Decision status, such as approved, assumed, open, revised, or rejected.",
                },
            },
            required: ["decision"],
            additionalProperties: false,
        },
        skipPermission: true,
        handler: async (args) => {
            if (!args.decision || args.decision.trim().length === 0) {
                return documentToolFailure("Decision must not be empty.");
            }
            await appendDecisionLogEntry(decisionLogPath, recordDecisionArgsToEntry(args));
            return {
                resultType: "success",
                textResultForLlm: `Recorded decision in ${decisionLogPath}`,
            };
        },
    };
}
function recordDecisionArgsToEntry(args) {
    return {
        decision: args.decision,
        rationale: args.rationale,
        section: args.section,
        source: args.source,
        status: args.status,
    };
}
function resolveReadableDocumentPath(requestedPath, options, readableDocuments) {
    const trimmedPath = requestedPath.trim();
    if (!trimmedPath) {
        return undefined;
    }
    const candidates = [
        isAbsolute(trimmedPath) ? resolve(trimmedPath) : resolve(options.workspacePath, trimmedPath),
        resolve(options.outputDir, trimmedPath),
    ];
    const allowedPaths = new Set(readableDocuments.map((document) => resolve(document.path)));
    for (const candidate of candidates) {
        if (allowedPaths.has(candidate) || isInsideDirectory(options.outputDir, candidate)) {
            return candidate;
        }
    }
    return undefined;
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
            if (!isInsideDirectory(resolvedOutputDir, resolvedTarget)) {
                return writeDocumentFailure("Document path must stay inside the output directory.");
            }
            const relativeTarget = relative(resolvedOutputDir, resolvedTarget);
            await mkdir(dirname(resolvedTarget), { recursive: true });
            await writeFile(resolvedTarget, content, "utf8");
            return {
                resultType: "success",
                textResultForLlm: `Successfully wrote ${content.length} bytes to ${relativeTarget}`,
            };
        },
    };
}
function isInsideDirectory(directory, path) {
    const relativeTarget = relative(resolve(directory), resolve(path));
    return relativeTarget === "" || (!relativeTarget.startsWith("..") && !isAbsolute(relativeTarget));
}
async function logCopilotRuntimeDiagnostics(client, verbose) {
    try {
        const authStatus = await client.getAuthStatus();
        if (verbose) {
            logVerboseValue("Copilot auth authenticated", authStatus.isAuthenticated);
            logVerboseValue("Copilot auth type", authStatus.authType ?? "unknown");
            logVerboseValue("Copilot auth host", authStatus.host ?? "unknown");
            logVerboseValue("Copilot auth login", authStatus.login ?? "unknown");
            if (authStatus.statusMessage) {
                logVerboseValue("Copilot auth status", authStatus.statusMessage);
            }
        }
    }
    catch (error) {
        if (verbose) {
            logVerboseValue("Copilot auth status error", getErrorMessage(error));
        }
    }
    try {
        const models = await client.listModels();
        if (verbose) {
            logVerboseValue("Copilot model count", models.length);
            logVerboseListValues("Copilot available models", models.map((model) => `${model.id}${model.name ? ` (${model.name})` : ""}`));
        }
        return models;
    }
    catch (error) {
        if (verbose) {
            logVerboseValue("Copilot model list error", getErrorMessage(error));
        }
        return [];
    }
}
function assertCopilotModelAvailable(requestedModel, models) {
    if (!requestedModel || models.length === 0) {
        return;
    }
    const availableModelIds = new Set(models.map((model) => model.id));
    if (availableModelIds.has(requestedModel)) {
        return;
    }
    throw new Error(`Copilot model is not available: ${requestedModel}. Run with --verbose and choose one of the listed Copilot available models, or omit --model to use the Copilot default.`);
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
    return documentToolFailure(message);
}
function documentToolFailure(message) {
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
function logVerboseListValues(label, values) {
    process.stderr.write(`[verbose] ${label}: ${values.length}\n`);
    for (const value of values) {
        process.stderr.write(`[verbose]   - ${value}\n`);
    }
}
function getErrorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}
