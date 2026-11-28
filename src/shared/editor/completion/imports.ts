import { ifNotIn, insertCompletionText, pickedCompletion, type Completion, type CompletionContext, type CompletionResult, type CompletionSource } from "@codemirror/autocomplete";
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import { completionWeights, cppCompletionCatalog, pythonCompletionCatalog } from "./catalog";

type SyntaxNode = ReturnType<typeof syntaxTree>["topNode"];
type ImportEdit = { from: number; insert: string };

const { library: cppLibrary, umbrellaHeader, headers, directives } = cppCompletionCatalog;
const cppHeaders = [...new Set([...headers.common, ...Object.keys(cppLibrary), ...headers.other])];
const cppSymbols = Object.entries(cppLibrary).flatMap(([header, names]) => names.map(([label, type]) => ({ label, type, header })));
const cppLiteralNodes = ["LineComment", "BlockComment", "String", "RawString", "CharLiteral"];
const cppExcluded = [...cppLiteralNodes, "PreprocDirective"];

const { common: commonModules, other: otherModules } = pythonCompletionCatalog.modules;
const pythonLibrary = new Map(Object.entries({ ...commonModules, ...otherModules }));
const pythonMembers = new Map(Object.entries(pythonCompletionCatalog.members));
const pythonModuleNames = [...pythonLibrary.keys()].map((label) => [label, "namespace"] as const);
const commonModuleNames = Object.keys(commonModules);
const pythonExcluded = ["Comment", "String", "FormatString"];

function contestBoost(rank: number) {
  return rank < 0 ? 0 : Math.max(1, completionWeights.imports.rankedBonus - rank);
}

function ancestor(node: SyntaxNode, name: string): SyntaxNode | null {
  for (let current: SyntaxNode | null = node; current; current = current.parent) {
    if (current.name === name) return current;
  }
  return null;
}

const cppDirectiveOptions: Completion[] = [...directives.withArgument, ...directives.standalone].map((label, index) => ({
  label,
  displayLabel: `#${label}`,
  type: "keyword",
  apply: index < directives.withArgument.length ? `${label} ` : label,
  boost: contestBoost(index),
}));

export function cppDirectiveCompletions({ state, pos }: CompletionContext): CompletionResult | null {
  const line = state.doc.lineAt(pos);
  const prefix = /^[\t ]*#[\t ]*([A-Za-z_]*)$/.exec(state.sliceDoc(line.from, pos));
  if (!prefix) return null;

  const node = ensureSyntaxTree(state, pos, 8)?.resolveInner(pos, -1);
  if (!node || cppLiteralNodes.some((name) => ancestor(node, name))) return null;
  const directive = ancestor(node, "PreprocDirective");
  if (directive && directive.from < line.from) return null;

  const tail = /^[A-Za-z_]*/.exec(state.sliceDoc(pos, line.to))?.[0] ?? "";
  return {
    from: pos - prefix[1].length,
    to: pos + tail.length,
    options: cppDirectiveOptions,
    validFor: /^[A-Za-z_]*$/,
    getMatch: (_option, matched) => matched?.map((offset) => offset + 1) ?? [],
  };
}

function nextLine(state: EditorState, node: SyntaxNode) {
  const lastCharacter = Math.max(node.from, node.to - 1);
  return Math.min(state.doc.lineAt(lastCharacter).to + 1, state.doc.length);
}

function withImport(
  option: Omit<Completion, "apply">,
  resolve: (state: EditorState, from: number) => { text: string; importEdit?: ImportEdit },
): Completion {
  return {
    ...option,
    apply(view, completion, from, to) {
      const { state } = view;
      const { text, importEdit } = resolve(state, from);
      const insertion = { ...insertCompletionText(state, text, from, to), annotations: pickedCompletion.of(completion) };
      // Combining both edits in one transaction keeps completion and undo atomic.
      if (importEdit) view.dispatch({ changes: importEdit }, insertion);
      else view.dispatch(insertion);
    },
  };
}

function cppHeaderCompletion(context: CompletionContext, directive: SyntaxNode) {
  const keyword = directive.getChild("#include");
  if (!keyword || context.pos < keyword.to) return null;
  const { state, pos } = context;
  const line = state.doc.lineAt(pos);
  if (keyword.to < line.from) return null;

  const match = /^[\t ]*([<"]?)([\w./+-]*)$/.exec(state.sliceDoc(keyword.to, pos));
  if (!match) return null;
  const [, opener, prefix] = match;
  const tail = /^[\w./+-]*/.exec(state.sliceDoc(pos, line.to))?.[0] ?? "";
  const to = pos + tail.length;
  const closer = opener === '"' ? '"' : ">";
  const hasCloser = state.sliceDoc(to, to + 1) === closer;

  return {
    from: pos - prefix.length,
    to,
    validFor: opener ? /^[\w./+-]*$/ : undefined,
    options: cppHeaders.map((label) => ({
      label,
      type: "header",
      boost: contestBoost(headers.common.indexOf(label)),
      apply: opener ? label + (hasCloser ? "" : closer) : `${keyword.to === pos - prefix.length ? " " : ""}<${label}>`,
    })),
  };
}

function cppImportEdit(state: EditorState, from: number, header: string): ImportEdit | undefined {
  let at = 0;
  let depth = 0;
  let preamble = true;
  for (let node = syntaxTree(state).topNode.firstChild; node && node.to <= from; node = node.nextSibling) {
    if (node.name === "LineComment" || node.name === "BlockComment") {
      if (preamble && depth === 0 && nextLine(state, node) <= from) at = nextLine(state, node);
      continue;
    }
    if (node.name !== "PreprocDirective") {
      preamble = false;
      continue;
    }

    const directive = node.firstChild?.name;
    if (directive === "#if" || directive === "#ifdef" || directive === "#ifndef") depth++;
    if (directive === "#endif") depth = Math.max(0, depth - 1);
    if (depth !== 0) continue;

    const included = node.getChild("SystemLibString");
    if (included) {
      const name = state.sliceDoc(included.from + 1, included.to - 1);
      if (name === header || name === umbrellaHeader) return undefined;
    }
    if (preamble && nextLine(state, node) <= from) at = nextLine(state, node);
  }
  return { from: at, insert: `#include <${header}>\n` };
}

const cppSymbolCompletion = ifNotIn(cppExcluded, (context) => {
  const { state, pos } = context;
  const word = context.matchBefore(/[\w]+/);
  const from = word?.from ?? pos;
  const line = state.doc.lineAt(from);
  const before = state.sliceDoc(line.from, from);
  if (/(?:\.|->)\s*$/.test(before)) return null;
  const qualifier = /(?:\b[A-Za-z_]\w*\s*::\s*)+$|::\s*$/.exec(before)?.[0].replace(/\s/g, "");
  if (qualifier && qualifier !== "std::") return null;
  if (!qualifier && !word && !context.explicit) return null;

  const tail = /^\w*/.exec(state.sliceDoc(pos, line.to))?.[0] ?? "";
  return {
    from,
    to: pos + tail.length,
    validFor: /^\w*$/,
    options: cppSymbols.map(({ label, type, header }) => withImport({
      label, type, detail: `std · <${header}>`, boost: contestBoost(cppCompletionCatalog.commonSymbols.indexOf(label)),
    }, (currentState, at) => ({
      text: qualifier ? label : `std::${label}`,
      importEdit: cppImportEdit(currentState, at, header),
    }))),
  };
});

export const cppImportCompletions: CompletionSource = (context) => {
  const tree = ensureSyntaxTree(context.state, context.pos, 8);
  if (!tree) return null;
  const directive = ancestor(tree.resolveInner(context.pos, -1), "PreprocDirective");
  return directive ? cppHeaderCompletion(context, directive) : cppSymbolCompletion(context);
};

function pythonImportCompletion(context: CompletionContext, statement: SyntaxNode) {
  const { state, pos } = context;
  const head = statement.firstChild;
  if (!head) return null;
  const keyword = statement.getChild("import");
  const fromImport = head.name === "from" && keyword && keyword.to <= pos;
  let start = fromImport ? keyword.to : head.to;
  if (pos <= start) return null;
  const module = fromImport ? state.sliceDoc(head.to, keyword.from).trim() : undefined;
  const names = module === undefined ? pythonModuleNames : pythonLibrary.get(module);
  if (!names) return null;

  for (let node = statement.firstChild; node && node.to <= pos; node = node.nextSibling) {
    if (node.from >= start && (node.name === "," || node.name === "(" || node.name === "Comment")) start = node.to;
  }
  const match = /^\s*([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*\.?|)$/.exec(state.sliceDoc(start, pos));
  if (!match) return null;
  const prefixStart = pos - match[1].length;
  const line = state.doc.lineAt(pos);
  const tail = (fromImport ? /^\w*/ : /^[\w.]*/).exec(state.sliceDoc(pos, line.to))?.[0] ?? "";

  return {
    from: prefixStart,
    to: pos + tail.length,
    validFor: fromImport ? /^\w*$/ : /^[\w.]*$/,
    options: names.map(([label, type], index) => ({
      label, type, detail: module,
      boost: completionWeights.imports.pythonImportStatement + contestBoost(module === undefined ? commonModuleNames.indexOf(label) : index),
    })),
  };
}

function pythonImportedNames(state: EditorState, keyword: SyntaxNode) {
  const names = new Map<string, string>();
  for (let token = keyword.nextSibling; token;) {
    if (token.name === "*") names.set("*", "*");
    if (token.name !== "VariableName") {
      token = token.nextSibling;
      continue;
    }

    let end = token;
    while (end.nextSibling?.name === "." && end.nextSibling.nextSibling?.name === "VariableName") {
      end = end.nextSibling.nextSibling;
    }
    const name = state.sliceDoc(token.from, end.to);
    const alias = end.nextSibling?.name === "as" ? end.nextSibling.nextSibling : null;
    if (alias?.name === "VariableName") end = alias;
    names.set(name, alias?.name === "VariableName" ? state.sliceDoc(alias.from, alias.to) : name);
    token = end.nextSibling;
  }
  return names;
}

function* pythonStatements(root: SyntaxNode) {
  for (let node = root.firstChild; node; node = node.nextSibling) {
    if (node.name !== "StatementGroup") {
      yield node;
      continue;
    }
    for (let statement = node.firstChild; statement; statement = statement.nextSibling) {
      if (statement.name !== ";") yield statement;
    }
  }
}

function pythonImportBindings(state: EditorState, statement: SyntaxNode) {
  if (statement.name !== "ImportStatement") return undefined;
  const head = statement.firstChild;
  const keyword = statement.getChild("import");
  if (!head || !keyword) return undefined;
  const module = head.name === "from" ? state.sliceDoc(head.to, keyword.from).trim() : undefined;
  return { module, names: pythonImportedNames(state, keyword) };
}

function pythonMemberPath(state: EditorState, member: SyntaxNode, receiver: string) {
  const [root, ...properties] = receiver.split(".");
  for (let scope: SyntaxNode | null = member; scope; scope = scope.parent) {
    if (scope.name !== "Body" && !scope.type.isTop) continue;

    let path: string | null | undefined;
    for (const statement of pythonStatements(scope)) {
      if (statement.to > member.from) break;
      const target = statement.firstChild;
      if (statement.name === "AssignStatement" && target?.name === "VariableName" && state.sliceDoc(target.from, target.to) === root) {
        path = null;
      }
      const binding = pythonImportBindings(state, statement);
      if (!binding) continue;

      for (const [name, alias] of binding.names) {
        if (binding.module !== undefined) {
          if (alias === root) path = `${binding.module}.${name}`;
          continue;
        }
        const local = name === alias ? name.split(".")[0] : alias;
        if (local === root) path = name === alias ? local : name;
      }
    }
    if (path === null) return undefined;
    if (path !== undefined) return [path, ...properties].join(".");
  }
}

function pythonMemberCompletion(context: CompletionContext, member: SyntaxNode, dot: SyntaxNode) {
  const { state, pos } = context;
  const receiver = state.sliceDoc(member.from, dot.from).replace(/\s/g, "");
  if (!/^[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*$/.test(receiver)) return null;
  const path = pythonMemberPath(state, member, receiver);
  const names = path && (pythonLibrary.get(path) ?? pythonMembers.get(path));
  if (!names) return null;

  const prefix = /^\s*(\w*)$/.exec(state.sliceDoc(dot.to, pos));
  if (!prefix) return null;
  const prop = member.getChild("PropertyName");
  return {
    from: pos - prefix[1].length,
    to: Math.max(pos, prop?.to ?? pos),
    validFor: /^\w*$/,
    options: names.map(([label, type], index) => ({ label, type, detail: path, boost: contestBoost(index) })),
  };
}

function isPythonDocstring(statement: SyntaxNode) {
  if (statement.name !== "ExpressionStatement") return false;
  let expression = statement.firstChild;
  while (expression?.name === "ParenthesizedExpression") {
    expression = expression.getChild("String") ?? expression.getChild("ContinuedString") ?? expression.getChild("ParenthesizedExpression");
  }
  return expression?.name === "String" || expression?.name === "ContinuedString";
}

function pythonImportEdit(state: EditorState, from: number, module: string, name: string) {
  let at = 0;
  let inline = false;
  let firstStatement = true;
  let preamble = true;
  let moduleBinding: string | undefined;

  for (const node of pythonStatements(syntaxTree(state).topNode)) {
    if (node.to > from) break;
    const isComment = node.name === "Comment";
    const isDocstring = firstStatement && isPythonDocstring(node);
    if (preamble && (isComment || isDocstring || node.name === "ImportStatement")) {
      const end = nextLine(state, node);
      inline = end > from;
      at = inline ? node.to : end;
    } else {
      preamble = false;
    }
    if (!isComment) firstStatement = false;
    const imported = pythonImportBindings(state, node);
    if (!imported) continue;
    if (imported.module !== undefined) {
      if (imported.module !== module) continue;
      const binding = imported.names.get(name) ?? (imported.names.has("*") ? name : undefined);
      if (binding) return { text: binding };
    } else {
      moduleBinding = imported.names.get(module) ?? moduleBinding;
    }
  }
  if (moduleBinding) return { text: `${moduleBinding}.${name}` };
  const statement = `from ${module} import ${name}`;
  return { text: name, importEdit: { from: at, insert: inline ? `; ${statement}` : `${statement}\n` } };
}

const pythonSymbols = [...pythonLibrary].flatMap(([module, names]) => names.map(([label, type]) =>
  withImport({ label, type, detail: module,
    boost: contestBoost(pythonCompletionCatalog.commonSymbols.indexOf(label)) + completionWeights.imports.pythonAutoImport },
    (state, at) => pythonImportEdit(state, at, module, label))));

const pythonCodeCompletion = ifNotIn([...pythonExcluded, "PropertyName"], (context) => {
  const word = context.matchBefore(/[A-Za-z_]\w*/);
  if (!word) return null;
  const line = context.state.doc.lineAt(context.pos);
  if (/\.\s*$/.test(context.state.sliceDoc(line.from, word.from))) return null;
  const tail = /^\w*/.exec(context.state.sliceDoc(context.pos, line.to))?.[0] ?? "";
  return { from: word.from, to: context.pos + tail.length, validFor: /^\w*$/, options: pythonSymbols };
});

export const pythonImportCompletions: CompletionSource = ifNotIn(pythonExcluded, (context) => {
  const tree = ensureSyntaxTree(context.state, context.pos, 8);
  if (!tree) return null;
  const node = tree.resolveInner(context.pos, -1);
  const statement = ancestor(node, "ImportStatement");
  if (statement) return pythonImportCompletion(context, statement);
  const member = ancestor(node, "MemberExpression");
  const dot = member?.getChild(".");
  if (member && dot && context.pos >= dot.to) return pythonMemberCompletion(context, member, dot);
  return pythonCodeCompletion(context);
});
