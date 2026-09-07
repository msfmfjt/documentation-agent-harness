import { access, appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
export async function appendDecisionLogEntry(decisionLogPath, entry) {
    await mkdir(dirname(decisionLogPath), { recursive: true });
    const exists = await fileExists(decisionLogPath);
    const content = `${exists ? "" : "# Decisions\n\n"}${formatDecisionLogEntry(entry)}`;
    await appendFile(decisionLogPath, content, "utf8");
}
function formatDecisionLogEntry(entry) {
    const lines = [
        `## ${new Date().toISOString()}`,
        entry.section ? `- Section: ${singleLine(entry.section)}` : undefined,
        entry.status ? `- Status: ${singleLine(entry.status)}` : undefined,
        `- Decision: ${singleLine(entry.decision)}`,
        entry.rationale ? `- Rationale: ${singleLine(entry.rationale)}` : undefined,
        entry.source ? `- Source: ${singleLine(entry.source)}` : undefined,
        "",
    ].filter((line) => line !== undefined);
    return `${lines.join("\n")}\n`;
}
function singleLine(value) {
    return value.replace(/\s+/g, " ").trim();
}
async function fileExists(path) {
    try {
        await access(path);
        return true;
    }
    catch {
        return false;
    }
}
