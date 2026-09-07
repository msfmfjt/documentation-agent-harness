# Documentation Agent Harness

Minimal Pi SDK harness for generating Markdown documentation through an interactive drafting workflow based on reference documents and templates.

## Capabilities

- Starts an agent session with Pi's `createAgentSession()`
- Reads user-provided reference documents and extracts relevant information
- Follows the section structure and required fields from a template
- Proposes section-level editing plans and drafts
- Revises drafts based on user feedback
- Creates or edits Markdown files after user confirmation
- Does not inspect source code by default
- Enables `read`, `edit`, and a constrained `write_document` tool, keeping the workflow focused on provided materials and documentation output

## Setup

```bash
npm install
```

Pi authentication is required. Use the Pi CLI `/login` flow or configure the API key for the model provider you use.

## Global Install

Install the CLI directly from GitHub:

```bash
npm install -g github:msfmfjt/documentation-agent-harness
```

For a private repository, your local Git/GitHub credentials must be able to read the repository.

After installation, run the CLI with `doc-harness`:

```bash
doc-harness \
  --workspace /path/to/workspace \
  --template docs/templates/document-template.md \
  --reference docs/source-material.md \
  --output docs/generated
```

Node.js `22.19.0` or newer is required.

The GitHub installation uses the committed `dist/` files, so it does not run a TypeScript build on the installing machine.

## Usage

```bash
npm run doc -- \
  --workspace /path/to/workspace \
  --template docs/templates/document-template.md \
  --reference docs/source-material.md \
  --reference-dir docs/reference-materials \
  --output docs/generated \
  --mode draft \
  --model anthropic/claude-sonnet-4-5
```

After startup, the agent reviews the template and reference documents, then asks which section to handle first or what missing information needs to be clarified. You provide feedback in the terminal and build the document section by section.

Type `/exit` or `/quit` to end the session.

Options:

- `--workspace`: Working directory for documentation generation. Defaults to the current directory.
- `--target`: Legacy alias for `--workspace`.
- `--runtime`: Agent runtime to use. One of `pi` or `copilot`. Defaults to `pi`.
- `--output`: Output directory, relative to the workspace or absolute.
- `--template`: Template that defines the target document sections and required fields.
- `--reference`: Reference document to use while drafting. Can be specified multiple times.
- `--reference-dir`: Directory of reference documents. Files are discovered recursively.
- `--reference-ext`: Reference file extension to include when using `--reference-dir`. Can be specified multiple times or as a comma-separated list.
- `--draft`: Existing draft to edit. If omitted, the session assumes a new document.
- `--mode`: Initial mode. One of `overview`, `api`, `architecture`, `onboarding`, `draft`, or `full`.
- `--model`: Model to use. For Pi runtime, use `provider/model-id`. For Copilot runtime, use the Copilot model id.
- `--models-file`: Path to a custom Pi `models.json` file.
- `--auth-file`: Path to a custom Pi `auth.json` file.
- `--copilot-cli-path`: Path to a Copilot CLI executable to use with Copilot runtime. Can also be set with `COPILOT_CLI_PATH`.
- `--copilot-home`: Copilot runtime home directory. Can also be set with `COPILOT_HOME`.
- `--persist-session`: Save the session so it can be resumed later.
- `--resume`: Continue the most recent persisted session for the workspace.
- `--session-file`: Resume a specific Pi session JSONL file.
- `--session-dir`: Directory for persisted sessions. Defaults to Pi's workspace-specific session directory.
- `--extension`: Pi extension file to load. Can be specified multiple times.
- `--tool`: Additional tool name to enable. Use this when an extension registers a custom tool.
- `--verbose`: Print debugging details about resolved paths, loaded extensions, providers, models, and selected model.
- `--audience`: Initial target audience. The audience can be revised during the session.

Default reference extensions are `.md`, `.rst`, and `.tex`.

See [docs/template-authoring.md](docs/template-authoring.md) for guidance on writing templates.

## Workflow

1. The agent reads the template and reference documents.
2. The agent summarizes required sections and information available from the references.
3. The agent proposes an editing plan or draft for the first section.
4. The user provides revision direction or additional information.
5. The agent revises the section.
6. The same loop continues for each section.
7. After user approval, the agent creates or edits the Markdown file.

Final documentation files are written through the built-in harness tool `write_document`. It accepts paths relative to `--output` and rejects absolute paths or paths that leave the output directory.

## Session Resume

By default, sessions are in-memory and disappear when the process exits. Use `--persist-session` when you want to resume a drafting session later:

```bash
doc-harness \
  --workspace /path/to/project \
  --template docs/templates/document-template.md \
  --reference-dir docs/references \
  --output docs/generated \
  --persist-session
```

The harness writes a sidecar metadata file next to the Pi session file. It stores the effective template, references, output directory, model, extension paths, and enabled tools for resume. It does not store API keys or `--auth-file`.
The output directory is created again after metadata is restored, so resumed sessions can write to the saved output location.

At exit, the CLI prints the session file path. Resume the most recent persisted session for the workspace with:

```bash
doc-harness \
  --workspace /path/to/project \
  --resume
```

Resume a specific session file with:

```bash
doc-harness \
  --workspace /path/to/project \
  --session-file /path/to/session.jsonl
```

When resuming, CLI options you specify override the saved metadata. Options you omit are restored from the saved metadata when available.

## Example

```bash
npm run doc -- \
  --workspace /path/to/project \
  --template docs/templates/document-template.md \
  --reference docs/source-material.md \
  --reference-dir docs/background-notes \
  --reference-ext md,txt \
  --output docs/generated \
  --mode draft \
  --audience "internal reviewers"
```

In this example, the agent reviews each template section and extracts usable information from the reference documents. It then proposes section drafts one at a time and revises them based on user feedback.

## Extensions and Custom Providers

The harness can load Pi extensions through `--extension`. This is the recommended way to add custom providers, custom tools, provider request hooks, or organization-specific behavior without hard-coding it into the documentation workflow.

Custom providers can be registered inside an extension with `pi.registerProvider()`. For example, [examples/extensions/openai-compatible-provider.ts](examples/extensions/openai-compatible-provider.ts) registers a generic OpenAI-compatible provider named `custom-openai`.

```bash
CUSTOM_OPENAI_BASE_URL="https://gateway.example.com/v1" \
CUSTOM_OPENAI_API_KEY="..." \
CUSTOM_OPENAI_MODEL="documentation-model" \
npm run doc -- \
  --workspace /path/to/project \
  --template docs/templates/document-template.md \
  --reference docs/source-material.md \
  --extension examples/extensions/openai-compatible-provider.ts \
  --model custom-openai/documentation-model \
  --output docs/generated
```

You can also provide a custom Pi `models.json` file:

```bash
npm run doc -- \
  --workspace /path/to/project \
  --template docs/templates/document-template.md \
  --reference docs/source-material.md \
  --models-file config/models.json \
  --model my-provider/my-model \
  --output docs/generated
```

If an extension registers custom tools, pass each tool name with `--tool`. The built-in documentation workflow enables `read`, `edit`, and `write_document` by default.

Use `--verbose` when debugging custom provider loading:

```bash
doc-harness \
  --workspace /path/to/project \
  --template docs/templates/document-template.md \
  --reference-dir docs/references \
  --extension /absolute/path/to/provider-extension.ts \
  --model custom-provider/custom-model \
  --output docs/generated \
  --verbose
```

Verbose output includes resolved reference paths, resolved extension paths, extension load errors, registered providers, available models, and the selected model. It does not print API keys.

If a custom provider appears in verbose output but its models do not, check where the extension registers models. Dynamic model discovery should run in the async extension factory so models are available before the harness selects `--model`:

```typescript
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default async function (pi: ExtensionAPI) {
  const models = await fetchModelsFromYourProvider();

  pi.registerProvider("custom-provider", {
    name: "Custom Provider",
    baseUrl: "https://gateway.example.com/v1",
    apiKey: "$CUSTOM_PROVIDER_API_KEY",
    api: "openai-completions",
    models,
  });
}
```

Avoid registering dynamically discovered models only from a `session_start` handler. In SDK-driven startup, the harness must select a model before sending the first prompt, so models registered later may not be available in time.

## GitHub Copilot Runtime

The harness can also run through GitHub Copilot SDK while reusing your existing Copilot CLI login state:

```bash
npm install -g @github/copilot
copilot
# Run /login inside Copilot CLI if you are not already signed in.
```

Then start the harness with `--runtime copilot`:

```bash
doc-harness \
  --runtime copilot \
  --workspace /path/to/project \
  --template docs/templates/document-template.md \
  --reference-dir docs/references \
  --output docs/generated
```

For Copilot runtime, `--model` is passed directly as the Copilot model id. If omitted, the SDK uses its automatic default model selection:

```bash
doc-harness \
  --runtime copilot \
  --model gpt-5 \
  --workspace /path/to/project \
  --template docs/templates/document-template.md \
  --reference docs/source-material.md \
  --output docs/generated
```

Pi-specific options such as `--extension`, `--models-file`, and `--auth-file` apply only to the Pi runtime.

The Copilot runtime supports `@github/copilot-sdk` `1.0.11` or newer.
By default, the Copilot runtime uses `COPILOT_HOME` when set, otherwise `~/.copilot`, so it can reuse the login state created by `copilot /login`.
Use `--copilot-home` when you need to force the harness to use the same Copilot home directory as the CLI:

```bash
doc-harness \
  --runtime copilot \
  --copilot-home ~/.copilot \
  --workspace /path/to/project \
  --template docs/templates/document-template.md \
  --reference-dir docs/references \
  --output docs/generated
```

On Windows, pass the full user profile path when needed:

```powershell
doc-harness `
  --runtime copilot `
  --copilot-home "C:\Users\<user>\.copilot" `
  --workspace "C:\path\to\project" `
  --template docs\templates\document-template.md `
  --reference-dir docs\references `
  --output docs\generated
```

If startup fails with `Could not resolve a @github/copilot platform package`, make sure optional dependencies are installed. Do not install this package with `--omit=optional` or `--no-optional`. You can also point the harness at an existing Copilot CLI executable:

```bash
doc-harness \
  --runtime copilot \
  --copilot-cli-path /absolute/path/to/copilot \
  --workspace /path/to/project \
  --template docs/templates/document-template.md \
  --reference-dir docs/references \
  --output docs/generated
```

## Project Structure

- `src/cli.ts`: Parses CLI arguments, prepares the output directory, and starts the interactive session.
- `src/documentation-harness.ts`: Creates the Pi SDK session and forwards terminal input as user feedback.
- `src/copilot-harness.ts`: Creates the GitHub Copilot SDK session and forwards terminal input as user feedback.
- `src/prompts.ts`: Defines the system prompt and initial prompt for template-driven interactive drafting.
- `docs/template-authoring.md`: Explains how to write templates for the harness.
- `examples/extensions/openai-compatible-provider.ts`: Minimal custom provider extension for OpenAI-compatible endpoints.

## Future Improvements

- Save section approval state as JSON.
- Output a mapping between reference sources and generated content.
- Add required-field checks for templates.
- Add Markdown linting and link checking for generated files.
