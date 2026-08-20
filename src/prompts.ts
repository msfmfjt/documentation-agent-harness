export type DocumentationMode =
  | "overview"
  | "api"
  | "architecture"
  | "onboarding"
  | "draft"
  | "full";

export interface DocumentationPromptOptions {
  readonly workspacePath: string;
  readonly outputDir: string;
  readonly mode: DocumentationMode;
  readonly audience: string;
  readonly referencePaths: readonly string[];
  readonly templatePath?: string;
  readonly draftPath?: string;
}

export function buildInitialDocumentationPrompt(options: DocumentationPromptOptions): string {
  const referenceLines =
    options.referencePaths.length > 0
      ? options.referencePaths.map((path) => `  - ${path}`)
      : ["  - None provided yet"];

  return [
    "Start an interactive documentation drafting session.",
    "",
    "Context:",
    `- Workspace path: ${options.workspacePath}`,
    `- Documentation output directory: ${options.outputDir}`,
    `- Initial documentation mode: ${options.mode}`,
    `- Initial audience: ${options.audience}`,
    `- Template path: ${options.templatePath ?? "None provided yet"}`,
    `- Existing draft path: ${options.draftPath ?? "None provided yet"}`,
    "- Reference documents:",
    ...referenceLines,
    "",
    "Operating rules:",
    "- Use only the user conversation, provided template, provided reference documents, and existing draft as source material.",
    "- Do not inspect source code unless the user explicitly asks you to.",
    "- If a template is provided, follow its section structure and required fields.",
    "- If reference documents are provided, extract only information relevant to the target document.",
    "- Do not copy large passages from references. Summarize and adapt them for the target document.",
    "- Work section by section.",
    "- For each section, propose an editing plan or draft, ask for user feedback, then revise.",
    "- Keep each question round short: ask no more than five questions at a time.",
    "- Track assumptions, open questions, and decisions as you go.",
    "- Ask for confirmation before writing or editing files.",
    "- Write files only inside the documentation output directory.",
    "- When required information is missing from the references, mark the gap explicitly and ask the user for input.",
    "",
    "Suggested workflow:",
    "1. Read the template and reference documents if paths were provided.",
    "2. Summarize the template sections and the relevant source facts.",
    "3. Ask which section to draft first, unless the template implies a clear order.",
    "4. Draft one section at a time.",
    "5. Incorporate user feedback before moving to the next section.",
    "6. When all sections are approved, ask whether to write the Markdown file.",
    "",
    "Begin by briefly stating what inputs are available, then ask the first focused question or propose the first section to draft.",
  ].join("\n");
}

export const documentationSystemPrompt = [
  "You are a documentation drafting and editing agent.",
  "Your job is to use user-provided reference documents and templates to propose document drafts, gather feedback, and revise section by section.",
  "Do not infer product behavior from source code unless the user explicitly requests code inspection.",
  "Be precise about source references, assumptions, open questions, and confirmed decisions.",
].join(" ");
