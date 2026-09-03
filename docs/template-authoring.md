# Template Authoring Guide

This guide explains how to write document templates for the Documentation Agent Harness.

Templates are Markdown files that define the expected structure, required content, drafting rules, and review criteria for a generated document. The agent uses the template together with reference documents and user feedback to draft the final output section by section.

## Goals

A good template should help the agent answer four questions:

- What document should be produced?
- Who is the document for?
- Which sections are required?
- What counts as complete for each section?

The template does not need to contain final prose. It should provide enough structure and guidance for the agent to propose useful drafts and ask focused follow-up questions.

## Recommended Structure

Use this structure for most templates:

```markdown
# <Document Title>

## Document Purpose
Describe what this document is meant to accomplish.

## Audience
Describe the expected readers and their level of background knowledge.

## Source Material Guidance
Explain how reference documents should be used.

## Output Requirements
- Format:
- Tone:
- Required level of detail:
- Citation or traceability expectations:

## Section 1: <Section Name>
Purpose:

Required content:
- 
- 

Reference guidance:
- 

Questions to resolve:
- 

Completion criteria:
- [ ] 
- [ ] 

## Section 2: <Section Name>
Purpose:

Required content:
- 
- 

Reference guidance:
- 

Questions to resolve:
- 

Completion criteria:
- [ ] 
- [ ] 

## Final Review Checklist
- [ ] All required sections are complete.
- [ ] Important claims are supported by reference documents or user feedback.
- [ ] Assumptions are clearly marked.
- [ ] Open questions are listed.
- [ ] The tone fits the intended audience.
```

## Section Fields

Use consistent fields across sections so the agent can follow the same drafting loop.

- `Purpose`: What the section is trying to communicate.
- `Required content`: Information that must appear in the section.
- `Reference guidance`: Which kinds of source material are relevant.
- `Questions to resolve`: Missing information the agent should ask about.
- `Completion criteria`: Checks that determine whether the section is ready.

## Writing Guidance

Keep templates explicit and procedural. The agent works best when the template names the expected decisions, constraints, and review criteria.

Good template guidance:

```markdown
Required content:
- State the decision being documented.
- Summarize the rationale.
- List known tradeoffs.
- Identify unresolved questions.
```

Weak template guidance:

```markdown
Write a good explanation.
```

## Reference Guidance

If reference documents are expected, tell the agent how to use them.

Examples:

```markdown
Reference guidance:
- Use reference documents for factual background.
- Do not copy long passages directly.
- Mark any claim that is not supported by a reference as an assumption.
- Ask the user before adding information that is not present in the references.
```

## Completion Criteria

Completion criteria should be concrete. They help the agent decide when to ask for approval before moving to the next section.

Examples:

```markdown
Completion criteria:
- [ ] The section identifies the decision owner.
- [ ] The section separates confirmed facts from assumptions.
- [ ] The section lists open questions.
```

## Template Length

Prefer concise templates. A template should be long enough to define the expected document, but not so detailed that it becomes harder to follow than the final document.

As a rule of thumb:

- Short document: 3-6 sections.
- Medium document: 6-12 sections.
- Long document: split into multiple templates or use a section-based output layout.

## Common Mistakes

Avoid these patterns:

- Only listing headings with no required content.
- Mixing final prose with instructions without labeling the difference.
- Leaving the intended audience unspecified.
- Using vague instructions such as "be comprehensive" without defining scope.
- Requiring information that cannot be found in the references or supplied by the user.

## Minimal Template

Use this when you need a lightweight starting point:

```markdown
# <Document Title>

## Purpose
Describe the goal of the document.

## Audience
Describe who will read it.

## Section 1: <Section Name>
Required content:
- 

Questions to resolve:
- 

Completion criteria:
- [ ] 

## Section 2: <Section Name>
Required content:
- 

Questions to resolve:
- 

Completion criteria:
- [ ] 

## Final Review Checklist
- [ ] Required sections are complete.
- [ ] Assumptions are marked.
- [ ] Open questions are listed.
```
