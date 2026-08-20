import { mkdir, realpath } from "node:fs/promises";
import { resolve } from "node:path";

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
  readonly templatePath?: string;
  readonly draftPath?: string;
}

function parseArgs(argv: readonly string[]): CliArgs {
  const args = new Map<string, string>();
  const references: string[] = [];

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
    templatePath: args.get("template"),
    draftPath: args.get("draft"),
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
  const referencePaths = await Promise.all(
    args.referencePaths.map((path) => realpath(resolve(workspacePath, path))),
  );
  const templatePath = args.templatePath
    ? await realpath(resolve(workspacePath, args.templatePath))
    : undefined;
  const draftPath = args.draftPath
    ? await realpath(resolve(workspacePath, args.draftPath))
    : undefined;

  await mkdir(outputDir, { recursive: true });

  const options: DocumentationHarnessOptions = {
    ...args,
    workspacePath,
    outputDir,
    referencePaths,
    templatePath,
    draftPath,
  };

  process.stderr.write("Interactive documentation session started. Type /exit to finish.\n\n");
  const result = await runInteractiveDocumentationHarness(options);
  process.stderr.write(`\nDone. Session: ${result.sessionId}\n`);
  if (result.sessionFile) {
    process.stderr.write(`Session file: ${result.sessionFile}\n`);
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Error: ${message}\n`);
  process.exitCode = 1;
});
