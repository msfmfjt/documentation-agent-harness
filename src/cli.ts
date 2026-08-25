import { mkdir, readdir, realpath, stat } from "node:fs/promises";
import { extname, resolve } from "node:path";

import {
  runInteractiveDocumentationHarness,
  type DocumentationHarnessOptions,
} from "./documentation-harness.js";
import type { DocumentationMode } from "./prompts.js";

interface CliArgs {
  readonly workspacePath: string;
  readonly outputDir: string;
  readonly mode: DocumentationMode;
  readonly audience: string;
  readonly referencePaths: readonly string[];
  readonly referenceDirs: readonly string[];
  readonly referenceExtensions: readonly string[];
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
}

function parseArgs(argv: readonly string[]): CliArgs {
  const args = new Map<string, string>();
  const references: string[] = [];
  const referenceDirs: string[] = [];
  const referenceExtensions: string[] = [];
  const extensions: string[] = [];
  const tools: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      throw new Error(`Unexpected argument: ${token}`);
    }

    const key = token.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for --${key}`);
    }
    if (key === "reference") {
      references.push(value);
    } else if (key === "reference-dir") {
      referenceDirs.push(value);
    } else if (key === "reference-ext") {
      referenceExtensions.push(...parseReferenceExtensions(value));
    } else if (key === "extension") {
      extensions.push(value);
    } else if (key === "tool") {
      tools.push(value);
    } else {
      args.set(key, value);
    }
    index += 1;
  }

  return {
    workspacePath: args.get("workspace") ?? args.get("target") ?? process.cwd(),
    outputDir: args.get("output") ?? "docs/generated",
    mode: parseMode(args.get("mode") ?? "draft"),
    audience: args.get("audience") ?? "the intended documentation readers",
    referencePaths: references,
    referenceDirs,
    referenceExtensions:
      referenceExtensions.length > 0
        ? [...new Set(referenceExtensions)]
        : [".md", ".rst", ".tex"],
    extensionPaths: extensions,
    enabledTools: tools,
    templatePath: args.get("template"),
    draftPath: args.get("draft"),
    authPath: args.get("auth-file"),
    modelsPath: args.get("models-file"),
    model: parseModel(args.get("model")),
  };
}

function parseReferenceExtensions(value: string): string[] {
  return value
    .split(",")
    .map((extension) => extension.trim())
    .filter((extension) => extension.length > 0)
    .map((extension) => (extension.startsWith(".") ? extension : `.${extension}`));
}

function parseModel(value: string | undefined): CliArgs["model"] {
  if (!value) {
    return undefined;
  }

  const separatorIndex = value.indexOf("/");
  if (separatorIndex === -1 || separatorIndex === 0 || separatorIndex === value.length - 1) {
    throw new Error(`Invalid --model "${value}". Use provider/model-id.`);
  }

  return {
    provider: value.slice(0, separatorIndex),
    id: value.slice(separatorIndex + 1),
  };
}

function parseMode(value: string): DocumentationMode {
  const validModes = new Set([
    "overview",
    "api",
    "architecture",
    "onboarding",
    "draft",
    "full",
  ]);
  if (!validModes.has(value)) {
    throw new Error(`Invalid mode "${value}". Use one of: ${Array.from(validModes).join(", ")}`);
  }
  return value as DocumentationMode;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const workspacePath = await realpath(resolve(args.workspacePath));
  const outputDir = resolve(workspacePath, args.outputDir);
  const explicitReferencePaths = await Promise.all(
    args.referencePaths.map((path) => realpath(resolve(workspacePath, path))),
  );
  const referenceDirPaths = await Promise.all(
    args.referenceDirs.map((path) => realpath(resolve(workspacePath, path))),
  );
  const discoveredReferencePaths = await collectReferenceFiles(
    referenceDirPaths,
    args.referenceExtensions,
  );
  const referencePaths = [...new Set([...explicitReferencePaths, ...discoveredReferencePaths])];
  const extensionPaths = await Promise.all(
    args.extensionPaths.map((path) => realpath(resolve(workspacePath, path))),
  );
  const templatePath = args.templatePath
    ? await realpath(resolve(workspacePath, args.templatePath))
    : undefined;
  const draftPath = args.draftPath
    ? await realpath(resolve(workspacePath, args.draftPath))
    : undefined;
  const authPath = args.authPath ? await realpath(resolve(workspacePath, args.authPath)) : undefined;
  const modelsPath = args.modelsPath
    ? await realpath(resolve(workspacePath, args.modelsPath))
    : undefined;

  await mkdir(outputDir, { recursive: true });

  const options: DocumentationHarnessOptions = {
    ...args,
    workspacePath,
    outputDir,
    referencePaths,
    extensionPaths,
    templatePath,
    draftPath,
    authPath,
    modelsPath,
  };

  process.stderr.write("Interactive documentation session started. Type /exit to finish.\n\n");
  const result = await runInteractiveDocumentationHarness(options);
  process.stderr.write(`\nDone. Session: ${result.sessionId}\n`);
  if (result.sessionFile) {
    process.stderr.write(`Session file: ${result.sessionFile}\n`);
  }
}

async function collectReferenceFiles(
  directories: readonly string[],
  extensions: readonly string[],
): Promise<string[]> {
  const extensionSet = new Set(extensions.map((extension) => extension.toLowerCase()));
  const files: string[] = [];

  for (const directory of directories) {
    await collectReferenceFilesFromDirectory(directory, extensionSet, files);
  }

  return files.sort();
}

async function collectReferenceFilesFromDirectory(
  directory: string,
  extensions: ReadonlySet<string>,
  files: string[],
): Promise<void> {
  const entries = await readdir(directory, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      await collectReferenceFilesFromDirectory(fullPath, extensions, files);
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }

    const info = await stat(fullPath);
    if (!info.isFile()) {
      continue;
    }

    const extension = extname(entry.name).toLowerCase();
    if (extensions.has(extension)) {
      files.push(await realpath(fullPath));
    }
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Error: ${message}\n`);
  process.exitCode = 1;
});
