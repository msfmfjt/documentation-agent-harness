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
- Enables only `read`, `write`, and `edit` tools, keeping the workflow focused on provided materials and documentation output

## Setup

```bash
npm install
```

Pi authentication is required. Use the Pi CLI `/login` flow or configure the API key for the model provider you use.

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
- `--output`: Output directory, relative to the workspace or absolute.
- `--template`: Template that defines the target document sections and required fields.
- `--reference`: Reference document to use while drafting. Can be specified multiple times.
- `--reference-dir`: Directory of reference documents. Files are discovered recursively.
- `--reference-ext`: Reference file extension to include when using `--reference-dir`. Can be specified multiple times or as a comma-separated list.
- `--draft`: Existing draft to edit. If omitted, the session assumes a new document.
- `--mode`: Initial mode. One of `overview`, `api`, `architecture`, `onboarding`, `draft`, or `full`.
- `--model`: Model to use, in `provider/model-id` format.
- `--models-file`: Path to a custom Pi `models.json` file.
- `--auth-file`: Path to a custom Pi `auth.json` file.
- `--extension`: Pi extension file to load. Can be specified multiple times.
- `--tool`: Additional tool name to enable. Use this when an extension registers a custom tool.
- `--audience`: Initial target audience. The audience can be revised during the session.

Default reference extensions are `.md`, `.mdx`, `.txt`, `.rst`, and `.adoc`.

## Workflow

1. The agent reads the template and reference documents.
2. The agent summarizes required sections and information available from the references.
3. The agent proposes an editing plan or draft for the first section.
4. The user provides revision direction or additional information.
5. The agent revises the section.
6. The same loop continues for each section.
7. After user approval, the agent creates or edits the Markdown file.

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

If an extension registers custom tools, pass each tool name with `--tool`. The built-in documentation workflow enables only `read`, `write`, and `edit` by default.

## Project Structure

- `src/cli.ts`: Parses CLI arguments, prepares the output directory, and starts the interactive session.
- `src/documentation-harness.ts`: Creates the Pi SDK session and forwards terminal input as user feedback.
- `src/prompts.ts`: Defines the system prompt and initial prompt for template-driven interactive drafting.
- `examples/extensions/openai-compatible-provider.ts`: Minimal custom provider extension for OpenAI-compatible endpoints.

## Future Improvements

- Save section approval state as JSON.
- Output a mapping between reference sources and generated content.
- Add required-field checks for templates.
- Add Markdown linting and link checking for generated files.
