import { CompletionContext, type Completion, type CompletionSource } from "@codemirror/autocomplete";
import { localCompletionSource } from "@codemirror/lang-python";
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import { completionWeights, cppCompletionCatalog, pythonCompletionCatalog, variableNames } from "./catalog";

type SyntaxNode = ReturnType<typeof syntaxTree>["topNode"];
type BindingType = { detail: string; name?: string };

const priority = completionWeights.variables;
const cppMethods = new Map<string, { read: readonly string[]; write: readonly string[] }>(Object.entries(cppCompletionCatalog.methods));
const pythonMethods = new Map<string, readonly string[]>(Object.entries(pythonCompletionCatalog.methods));
const validIdentifier = /^\p{ID_Continue}*$/u;
const cppDeclarators = new Set([
  "Identifier", "InitDeclarator", "PointerDeclarator", "ReferenceDeclarator", "ArrayDeclarator",
  "ParenthesizedDeclarator", "StructuredBindingDeclarator", "FunctionDeclarator",
]);
const cppDeclarationNodes = new Set(["Declaration", "ParameterDeclaration"]);
const cppExcluded = new Set([
  "LineComment", "BlockComment", "String", "RawString", "CharLiteral", "SystemLibString", "PreprocDirective",
  "FieldExpression", "ScopedIdentifier", "ScopedTypeIdentifier", "ScopedNamespaceIdentifier",
]);
const cppScopeNodes = new Set([
  "Program", "CompoundStatement", "Declaration", "ParameterList", "FunctionDefinition", "InitDeclarator", "LambdaExpression", "CatchClause",
  "ForStatement", "ForRangeLoop", "IfStatement", "SwitchStatement", "WhileStatement",
]);
const pythonExcluded = new Set(["Comment", "String", "FormatString", "ImportStatement", "PropertyName"]);
const pythonBuiltinConstructors = new Set(["list", "dict", "set", "str", "tuple", "bytes", "int", "float"]);
const pythonNonIterableTypes = new Set(["int", "float", "bool", "complex", "None"]);
const pythonLoopNames = pythonCompletionCatalog.loopNames.map((label, index) => ({
  label, type: "variable", boost: priority.rankedBonus - index,
}));
const pythonIterableFunctions = pythonCompletionCatalog.iterableFunctions.map((label, index) => ({
  label, type: "function", boost: priority.rankedBonus - index,
}));
const pythonInKeyword = { label: "in", type: "keyword", apply: "in " };
const pythonExpressionScopes = new Set([
  "LambdaExpression", "ArrayComprehensionExpression", "DictionaryComprehensionExpression",
  "SetComprehensionExpression", "ComprehensionExpression",
]);

function bindingBoost(scopeDistance: number, order: number) {
  return Math.max(priority.outerBinding,
    priority.nearestBinding - priority.scopePenalty * scopeDistance - Math.min(order, priority.maxOrderPenalty));
}

function addPresetNames(options: Map<string, Completion>, naming: boolean) {
  const base = naming ? priority.declarationName : priority.referenceName;
  for (const [index, label] of variableNames.common.entries()) {
    if (!options.has(label)) options.set(label, { label, type: "variable", boost: base + Math.max(1, priority.rankedBonus - index) });
  }
  for (const label of variableNames.other) {
    if (!options.has(label)) options.set(label, { label, type: "variable", boost: base });
  }
}

function identifierRange(context: CompletionContext) {
  const word = context.matchBefore(/[\p{ID_Start}_]\p{ID_Continue}*/u);
  const line = context.state.doc.lineAt(context.pos);
  const from = word?.from ?? context.pos;
  const tail = /^\p{ID_Continue}*/u.exec(context.state.sliceDoc(context.pos, line.to))?.[0] ?? "";
  return { word, from, to: context.pos + tail.length, before: context.state.sliceDoc(line.from, from) };
}

function memberReceiver(state: EditorState, node: SyntaxNode, from: number, expression: string, identifier: string) {
  for (let current: SyntaxNode | null = node; current; current = current.parent) {
    if (current.name !== expression) continue;
    const receiver = current.firstChild;
    return receiver?.name === identifier && receiver.to < from && /^\s*\.\s*$/.test(state.sliceDoc(receiver.to, from))
      ? receiver : null;
  }
  return null;
}

function methodCompletions(from: number, to: number, detail: string, methods: readonly string[]) {
  return {
    from, to, validFor: validIdentifier,
    options: methods.map((label, index) => ({ label, detail, type: "method", boost: Math.max(1, priority.rankedBonus - index) })),
  };
}

function inContext(node: SyntaxNode, excluded: ReadonlySet<string>, expressionBoundary?: string) {
  for (let current: SyntaxNode | null = node; current; current = current.parent) {
    if (excluded.has(current.name)) return false;
    if (current.name === expressionBoundary) return true;
  }
  return true;
}

function* children(node: SyntaxNode) {
  for (let child = node.firstChild; child; child = child.nextSibling) yield child;
}

function* cppDeclaratorNames(node: SyntaxNode): Generator<SyntaxNode> {
  if (node.name === "Identifier") {
    yield node;
  } else if (node.name === "StructuredBindingDeclarator") {
    yield* node.getChildren("Identifier");
  } else if (node.name !== "FunctionDeclarator") {
    const inner = [...children(node)].find((child) => cppDeclarators.has(child.name));
    if (inner) yield* cppDeclaratorNames(inner);
  }
}

function* cppDeclarationNames(node: SyntaxNode): Generator<SyntaxNode> {
  for (const child of children(node)) {
    if (cppDeclarators.has(child.name)) yield* cppDeclaratorNames(child);
  }
}

function* cppScopeBindings(scope: SyntaxNode, from: number): Generator<SyntaxNode> {
  switch (scope.name) {
    case "Program":
    case "CompoundStatement":
    case "ParameterList":
      for (let statement = scope.childBefore(from); statement; statement = statement.prevSibling) {
        if (statement.to <= from && cppDeclarationNodes.has(statement.name)) {
          yield* [...cppDeclarationNames(statement)].reverse();
        }
      }
      return;
    case "Declaration":
      yield* [...cppDeclarationNames(scope)].reverse();
      return;
    case "FunctionDefinition":
    case "InitDeclarator":
    case "LambdaExpression":
    case "CatchClause": {
      const declarator = scope.getChild("FunctionDeclarator") ?? scope.getChild("AbstractFunctionDeclarator");
      const parameters = declarator?.getChild("ParameterList") ?? scope.getChild("ParameterList");
      if (parameters && parameters.to <= from) {
        for (const parameter of parameters.getChildren("ParameterDeclaration").reverse()) yield* cppDeclarationNames(parameter);
      }
      return;
    }
    case "ForRangeLoop": {
      const end = scope.getChild(")");
      const variable = [...children(scope)].find((child) => cppDeclarators.has(child.name));
      if (variable && end && end.to <= from) yield* cppDeclaratorNames(variable);
      return;
    }
    default: {
      const declaration = scope.getChild("Declaration") ?? scope.getChild("ConditionClause")?.getChild("Declaration");
      if (declaration) yield* cppDeclarationNames(declaration);
    }
  }
}

function cppNamingPosition(node: SyntaxNode, from: number, pos: number) {
  for (let current: SyntaxNode | null = node; current; current = current.parent) {
    if (cppDeclarationNodes.has(current.name) || current.name === "FunctionDefinition") {
      if ([...cppDeclarationNames(current)].some((name) => name.from <= from && name.to >= pos)) return true;
      return from === pos && current.lastChild?.type.isError === true && current.lastChild.from === pos;
    }
    if (current.name === "CompoundStatement" || current.name === "ExpressionStatement") return false;
  }
  return false;
}

function* cppVisibleBindings(state: EditorState, node: SyntaxNode, from: number) {
  const seen = new Set<string>();
  let scopeDistance = 0;
  for (let scope: SyntaxNode | null = node; scope; scope = scope.parent) {
    if (!cppScopeNodes.has(scope.name)) continue;
    let order = 0;
    for (const binding of cppScopeBindings(scope, from)) {
      if (binding.from >= from) continue;
      const label = state.sliceDoc(binding.from, binding.to);
      if (seen.has(label)) continue;
      seen.add(label);
      yield { binding, label, boost: bindingBoost(scopeDistance, order++) };
    }
    scopeDistance++;
  }
}

function cppBindingType(state: EditorState, binding: SyntaxNode) {
  let declaration = binding.parent;
  while (declaration && ["InitDeclarator", "ReferenceDeclarator", "ParenthesizedDeclarator"].includes(declaration.name)) {
    declaration = declaration.parent;
  }
  if (!declaration || (!cppDeclarationNodes.has(declaration.name) && declaration.name !== "ForRangeLoop")) return null;
  const type = [...children(declaration)].find((child) => child.name.endsWith("Type") || child.name.endsWith("TypeIdentifier"));
  if (!type) return null;
  const qualifier = type.name === "TemplateType" ? type.firstChild : type;
  const name = qualifier && state.sliceDoc(qualifier.from, qualifier.to).replace(/\s+/g, "");
  const readonly = declaration.getChild("const") !== null;
  return { name, readonly, detail: (readonly ? "const " : "") + state.sliceDoc(type.from, type.to) };
}

function cppStandardType(state: EditorState, binding: SyntaxNode, name: string) {
  if (name.startsWith("std::")) return name.slice(5);
  if (!cppMethods.has(name)) return undefined;
  for (let scope = binding.parent; scope; scope = scope.parent) {
    for (const using of scope.getChildren("UsingDeclaration")) {
      if (using.to > binding.from) break;
      const target = using.getChild("ScopedIdentifier") ?? using.getChild("Identifier");
      if (!target) continue;
      const imported = state.sliceDoc(target.from, target.to).replace(/\s+/g, "");
      if ((imported === "std" && using.getChild("namespace")) || imported === "std::" + name) return name;
    }
  }
}

export const cppVariableCompletions: CompletionSource = (context) => {
  const { state, pos } = context;
  const tree = ensureSyntaxTree(state, pos, 8);
  if (!tree) return null;
  const node = tree.resolveInner(pos, -1);
  const { word, from, to, before } = identifierRange(context);
  if (/\.\s*$/.test(before)) {
    const receiver = memberReceiver(state, node, from, "FieldExpression", "Identifier");
    if (!receiver) return null;
    const receiverName = state.sliceDoc(receiver.from, receiver.to);
    for (const { binding, label } of cppVisibleBindings(state, node, receiver.from)) {
      if (label !== receiverName) continue;
      const type = cppBindingType(state, binding);
      const standardType = type?.name && cppStandardType(state, binding, type.name);
      const methods = standardType && cppMethods.get(standardType);
      return type && methods
        ? methodCompletions(from, to, type.detail, type.readonly ? methods.read : [...methods.read, ...methods.write])
        : null;
    }
    return null;
  }
  if (!inContext(node, cppExcluded) || /(?:\.|->|::)\s*$/.test(before)) return null;
  const naming = cppNamingPosition(node, from, pos);
  if (!word && !naming && !context.explicit) return null;

  const options = new Map<string, Completion>();
  for (const { binding, label, boost } of cppVisibleBindings(state, node, from)) {
    options.set(label, { label, type: "variable", boost, detail: cppBindingType(state, binding)?.detail });
  }
  addPresetNames(options, naming);
  return { from, to, options: [...options.values()], validFor: validIdentifier };
};

function pythonNamingPosition(node: SyntaxNode, from: number, before: string) {
  const parent = node.parent;
  if (parent?.name === "AssignStatement") {
    const boundary = parent.getChild("TypeDef") ?? parent.getChild("AssignOp");
    return boundary !== null && from < boundary.from;
  }
  if (parent?.name === "ForStatement") {
    const boundary = parent.getChild("in");
    return boundary !== null && from < boundary.from;
  }
  return parent?.name === "ParamList" || (parent?.name === "ExpressionStatement" && before.trim() === "");
}

function pythonAnnotation(state: EditorState, annotation: SyntaxNode): BindingType | undefined {
  const expression = annotation.getChild(":")?.nextSibling;
  if (!expression || expression.type.isError) return undefined;
  const base = expression.name === "MemberExpression" && expression.lastChild?.name === "]" ? expression.firstChild : expression;
  const name = base?.name === "VariableName" ? state.sliceDoc(base.from, base.to) : undefined;
  return { name, detail: state.sliceDoc(expression.from, expression.to) };
}

function pythonValueType(state: EditorState, expression: SyntaxNode, localNames: ReadonlySet<string>): BindingType | undefined {
  let name: string;
  switch (expression.name) {
    case "ArrayExpression":
    case "ArrayComprehensionExpression": name = "list"; break;
    case "DictionaryExpression":
    case "DictionaryComprehensionExpression": name = "dict"; break;
    case "SetExpression":
    case "SetComprehensionExpression": name = "set"; break;
    case "TupleExpression": name = "tuple"; break;
    case "FormatString": name = "str"; break;
    case "String": name = /^(?:br?|rb)["']/i.test(state.sliceDoc(expression.from, expression.to)) ? "bytes" : "str"; break;
    case "CallExpression": {
      const callee = expression.firstChild;
      if (callee?.name !== "VariableName") return undefined;
      name = state.sliceDoc(callee.from, callee.to);
      if (!pythonBuiltinConstructors.has(name) || localNames.has(name)) return undefined;
      break;
    }
    default: return undefined;
  }
  return { name, detail: name };
}

function pythonBindingTypes(state: EditorState, node: SyntaxNode, from: number, localNames: ReadonlySet<string>) {
  const types = new Map<string, BindingType>();
  let suite: SyntaxNode | null = node;
  while (suite && suite.name !== "Body" && !suite.type.isTop) {
    if (pythonExpressionScopes.has(suite.name)) return types;
    suite = suite.parent;
  }
  if (!suite) return types;

  const parameters = suite.parent?.name === "FunctionDefinition" ? suite.parent.getChild("ParamList") : null;
  for (const parameter of parameters?.getChildren("TypeDef") ?? []) {
    const target = parameter.prevSibling;
    const type = pythonAnnotation(state, parameter);
    if (type && target?.name === "VariableName" && ["(", ",", "/"].includes(target.prevSibling?.name ?? "")) {
      types.set(state.sliceDoc(target.from, target.to), type);
    }
  }
  for (const child of children(suite)) {
    if (child.from >= from) break;
    for (const statement of child.name === "StatementGroup" ? children(child) : [child]) {
      if (statement.to > from) break;
      if ([":", ";", "Comment", "PassStatement"].includes(statement.name)) continue;
      if (statement.name === "ExpressionStatement" && !state.sliceDoc(statement.from, statement.to).includes(":=")) continue;
      const target = statement.firstChild;
      const next = target?.nextSibling;
      if (statement.name === "AssignStatement" && target?.name === "VariableName" && next) {
        const value = next.name === "AssignOp" && !next.nextSibling?.nextSibling ? next.nextSibling : null;
        if (next.name === "TypeDef" || value) {
          const label = state.sliceDoc(target.from, target.to);
          const type = value ? pythonValueType(state, value, localNames) : pythonAnnotation(state, next);
          if (type) types.set(label, type);
          else types.delete(label);
          continue;
        }
      }
      if (statement.name === "UpdateStatement" && target?.name === "VariableName") {
        types.delete(state.sliceDoc(target.from, target.to));
        continue;
      }
      // A compound statement or an unrecognized write can change the binding.
      types.clear();
    }
  }
  return types;
}

function pythonForIterableOptions(context: CompletionContext, loop: SyntaxNode, inKeyword: SyntaxNode) {
  const { state, pos } = context;
  const locals = localCompletionSource(new CompletionContext(state, pos, true))?.options ?? [];
  const localNames = new Set(locals.map(({ label }) => label));
  const types = pythonBindingTypes(state, loop, loop.from, localNames);
  const targets = new Set(loop.getChildren("VariableName")
    .filter((target) => target.to <= inKeyword.from)
    .map(({ from, to }) => state.sliceDoc(from, to)));

  const options = new Map<string, Completion>();
  for (const [index, option] of locals.entries()) {
    if (option.type !== "variable" || options.has(option.label)) continue;
    const type = types.get(option.label);
    if ((targets.has(option.label) && !type) || pythonNonIterableTypes.has(type?.name ?? "")) continue;
    options.set(option.label, { ...option, detail: type?.detail ?? option.detail, boost: bindingBoost(0, index) });
  }
  for (const option of pythonIterableFunctions) {
    if (!localNames.has(option.label) || (targets.has(option.label) && !types.has(option.label))) {
      options.set(option.label, option);
    }
  }
  return [...options.values()];
}

export function pythonForCompletion(context: CompletionContext) {
  const { state, pos } = context;
  const line = state.doc.lineAt(pos);
  const head = /^[\t ]*(?:async[\t ]+)?for(?=[\t ])/.exec(state.sliceDoc(line.from, pos));
  if (!head) return null;

  const tree = ensureSyntaxTree(state, pos, 8);
  if (!tree || !inContext(tree.resolveInner(pos, -1), pythonExcluded, "FormatReplacement")) return null;

  const keywordEnd = line.from + head[0].length;
  // A partially typed "in" can be parsed as a separate expression.
  const keyword = tree.resolveInner(keywordEnd, -1);
  const loop = keyword.parent;
  if (keyword.name !== "for" || loop?.name !== "ForStatement") return null;

  const { word, from, to } = identifierRange(context);
  const inKeyword = loop.getChild("in");
  let options: readonly Completion[];
  if (inKeyword && pos > inKeyword.to) {
    if (!/^[\t ]+$/.test(state.sliceDoc(inKeyword.to, from))) return null;
    options = pythonForIterableOptions(context, loop, inKeyword);
  } else {
    const before = state.sliceDoc(keywordEnd, from);
    if (/^[\t ]+$|[,(][\t ]*$/.test(before)) options = pythonLoopNames;
    else if (/[\t ]$/.test(before)) options = "in".startsWith(word?.text ?? "") ? [pythonInKeyword] : [];
    else return null;
  }
  return { from, to, options, validFor: validIdentifier };
}

export const pythonVariableCompletions: CompletionSource = (context) => {
  const { state, pos } = context;
  const tree = ensureSyntaxTree(state, pos, 8);
  if (!tree) return null;
  const node = tree.resolveInner(pos, -1);
  const { word, from, to, before } = identifierRange(context);
  if (/\.\s*$/.test(before)) {
    const receiver = memberReceiver(state, node, from, "MemberExpression", "VariableName");
    if (!receiver) return null;
    const locals = localCompletionSource(new CompletionContext(state, receiver.to, false))?.options ?? [];
    const types = pythonBindingTypes(state, node, receiver.from, new Set(locals.map(({ label }) => label)));
    const type = types.get(state.sliceDoc(receiver.from, receiver.to));
    const methods = type?.name && pythonMethods.get(type.name);
    return type && methods ? methodCompletions(from, to, type.detail, methods) : null;
  }
  if (!inContext(node, pythonExcluded, "FormatReplacement")) return null;
  if (!word && !context.explicit) return null;

  const naming = pythonNamingPosition(node, from, before);
  const options = new Map<string, Completion>();
  const locals = localCompletionSource(context)?.options ?? [];
  const types = pythonBindingTypes(state, node, from, new Set(locals.map(({ label }) => label)));
  // The Python language package returns names from inner scopes first.
  for (const [order, option] of locals.entries()) {
    if (naming && option.type === "variable" && option.label === word?.text) continue;
    if (!options.has(option.label)) options.set(option.label, { ...option,
      detail: types.get(option.label)?.detail ?? option.detail, boost: bindingBoost(0, order) });
  }
  addPresetNames(options, naming);
  return { from, to, options: [...options.values()], validFor: validIdentifier };
};
