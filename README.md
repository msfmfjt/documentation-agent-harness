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
  --output docs/generated \
  --mode draft
```

After startup, the agent reviews the template and reference documents, then asks which section to handle first or what missing information needs to be clarified. You provide feedback in the terminal and build the document section by section.

Type `/exit` or `/quit` to end the session.

Options:

- `--workspace`: Working directory for documentation generation. Defaults to the current directory.
- `--target`: Legacy alias for `--workspace`.
- `--output`: Output directory, relative to the workspace or absolute.
- `--template`: Template that defines the target document sections and required fields.
- `--reference`: Reference document to use while drafting. Can be specified multiple times.
- `--draft`: Existing draft to edit. If omitted, the session assumes a new document.
- `--mode`: Initial mode. One of `overview`, `api`, `architecture`, `onboarding`, `draft`, or `full`.
- `--audience`: Initial target audience. The audience can be revised during the session.

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
  --reference docs/background-notes.md \
  --output docs/generated \
  --mode draft \
  --audience "internal reviewers"
```

In this example, the agent reviews each template section and extracts usable information from the reference documents. It then proposes section drafts one at a time and revises them based on user feedback.

## Project Structure

- `src/cli.ts`: Parses CLI arguments, prepares the output directory, and starts the interactive session.
- `src/documentation-harness.ts`: Creates the Pi SDK session and forwards terminal input as user feedback.
- `src/prompts.ts`: Defines the system prompt and initial prompt for template-driven interactive drafting.

## Future Improvements

- Save section approval state as JSON.
- Output a mapping between reference sources and generated content.
- Add required-field checks for templates.
- Add Markdown linting and link checking for generated files.
