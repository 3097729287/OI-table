import { invoke } from "@tauri-apps/api/core";
import type { Diagnostic } from "@codemirror/lint";
import type { Text } from "@codemirror/state";
import type { CodeLanguage } from "./codeLanguages";

interface CheckDiagnostic {
  line: number;
  column: number;
  endLine?: number;
  endColumn?: number;
  severity: "error" | "warning";
  message: string;
}

interface CheckReport {
  tool: string;
  diagnostics: CheckDiagnostic[];
}

function offset(doc: Text, lineNumber: number, column: number) {
  const line = doc.line(Math.max(1, Math.min(doc.lines, lineNumber)));
  let position = line.from;
  let remaining = column - 1;
  for (const character of line.text) {
    if (remaining <= 0) break;
    position += character.length;
    remaining -= 1;
  }
  return position;
}

function tokenEnd(doc: Text, from: number) {
  const rest = doc.sliceString(from, doc.lineAt(from).to);
  const word = /^[\p{ID_Continue}]+/u.exec(rest)?.[0];
  const character = rest.codePointAt(0);
  return from + (word?.length ?? (character === undefined ? 0 : character > 0xffff ? 2 : 1));
}

export async function checkEditorCode(language: CodeLanguage, doc: Text) {
  const report = await invoke<CheckReport>("check_editor_code", { language, source: doc.toString() });
  const diagnostics = report.diagnostics.map(({ line, column, endLine, endColumn, severity, message }): Diagnostic => {
    const from = offset(doc, line, column);
    const end = endLine === undefined || endColumn === undefined ? from : offset(doc, endLine, endColumn);
    return { from, to: end > from ? end : tokenEnd(doc, from), severity, message, source: report.tool };
  });
  return { tool: report.tool, diagnostics };
}
