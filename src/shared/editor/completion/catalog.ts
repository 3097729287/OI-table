type SymbolKind = "constant" | "function" | "method" | "property" | "type" | "variable";
type SymbolTable = Record<string, readonly (readonly [label: string, kind: SymbolKind])[]>;

const umbrellaHeader = "bits/stdc++.h";
const associativeMethods = ["find", "count", "size", "empty", "begin", "end"];
const associativeMutations = ["insert", "emplace", "erase", "clear"];

export const cppCompletionCatalog = {
  keywords: [
    "alignas", "alignof", "asm", "auto", "bool", "break", "case", "catch", "char", "class", "concept", "const",
    "consteval", "constexpr", "constinit", "continue", "decltype", "default", "delete", "do", "double", "else", "enum",
    "explicit", "export", "extern", "false", "float", "for", "friend", "goto", "if", "inline", "int", "long", "mutable",
    "namespace", "new", "noexcept", "nullptr", "operator", "private", "protected", "public", "requires", "return", "short",
    "signed", "sizeof", "static", "static_assert", "static_cast", "struct", "switch", "template", "this", "thread_local",
    "throw", "true", "try", "typedef", "typename", "union", "unsigned", "using", "virtual", "void", "volatile", "while",
  ],
  namespaces: ["std"],
  directives: {
    withArgument: ["include", "define", "if", "ifdef", "ifndef", "elif", "pragma", "undef", "error", "warning", "line"],
    standalone: ["else", "endif"],
  },
  snippets: [
    { label: "main", detail: "int main()", template: "int main() {\n\t${}\n\treturn 0;\n}" },
    { label: "for", detail: "for (int i …)", template: "for (int ${i} = 0; ${i} < ${n}; ++${i}) {\n\t${}\n}" },
  ],
  umbrellaHeader,
  headers: {
    common: [umbrellaHeader, "iostream", "vector", "algorithm", "string", "numeric", "queue", "map", "set", "deque", "utility", "bitset"],
    // Headers from library are also included, with the regular priority unless listed in common.
    other: ["cstdint", "cstdio", "cstdlib", "cstring", "iomanip", "random", "sstream"],
  },
  library: {
    algorithm: [
      ["binary_search", "function"], ["clamp", "function"], ["fill", "function"], ["lower_bound", "function"],
      ["max", "function"], ["min", "function"], ["nth_element", "function"], ["reverse", "function"],
      ["rotate", "function"], ["sort", "function"], ["stable_sort", "function"], ["unique", "function"],
      ["upper_bound", "function"], ["next_permutation", "function"],
    ],
    array: [["array", "type"]],
    bitset: [["bitset", "type"]],
    cmath: [["ceil", "function"], ["floor", "function"], ["hypot", "function"], ["sqrt", "function"]],
    deque: [["deque", "type"]],
    functional: [["function", "type"], ["greater", "type"], ["less", "type"]],
    iostream: [["cin", "variable"], ["cout", "variable"], ["cerr", "variable"], ["ios", "type"]],
    limits: [["numeric_limits", "type"]],
    map: [["map", "type"], ["multimap", "type"]],
    numeric: [["accumulate", "function"], ["gcd", "function"], ["iota", "function"], ["lcm", "function"], ["partial_sum", "function"]],
    queue: [["priority_queue", "type"], ["queue", "type"]],
    set: [["multiset", "type"], ["set", "type"]],
    stack: [["stack", "type"]],
    string: [["string", "type"], ["to_string", "function"]],
    tuple: [["make_tuple", "function"], ["tie", "function"], ["tuple", "type"]],
    unordered_map: [["unordered_map", "type"]],
    unordered_set: [["unordered_set", "type"]],
    utility: [["make_pair", "function"], ["move", "function"], ["pair", "type"], ["swap", "function"]],
    vector: [["vector", "type"]],
  } satisfies SymbolTable,
  commonSymbols: [
    "vector", "sort", "cin", "cout", "lower_bound", "upper_bound", "pair", "queue", "priority_queue", "map", "set", "gcd",
    "deque", "string", "accumulate", "iota", "unordered_map", "unordered_set", "reverse", "max", "min",
  ],
  methods: {
    vector: { read: ["size", "empty", "front", "back", "begin", "end", "at", "data", "capacity"],
      write: ["push_back", "pop_back", "emplace_back", "resize", "reserve", "clear", "insert", "erase"] },
    deque: { read: ["size", "empty", "front", "back", "begin", "end", "at"],
      write: ["push_back", "push_front", "pop_back", "pop_front", "clear", "insert", "erase"] },
    string: { read: ["size", "length", "empty", "substr", "find", "begin", "end", "c_str"],
      write: ["push_back", "pop_back", "append", "replace", "erase", "clear"] },
    array: { read: ["size", "empty", "front", "back", "begin", "end", "at", "data"], write: ["fill", "swap"] },
    map: { read: [...associativeMethods, "lower_bound", "upper_bound", "at"], write: associativeMutations },
    set: { read: [...associativeMethods, "lower_bound", "upper_bound"], write: associativeMutations },
    unordered_map: { read: [...associativeMethods, "at"], write: associativeMutations },
    unordered_set: { read: associativeMethods, write: associativeMutations },
    queue: { read: ["front", "back", "empty", "size"], write: ["push", "pop", "emplace"] },
    stack: { read: ["top", "empty", "size"], write: ["push", "pop", "emplace"] },
    priority_queue: { read: ["top", "empty", "size"], write: ["push", "pop", "emplace"] },
  } satisfies Record<string, { read: readonly string[]; write: readonly string[] }>,
};

export const pythonCompletionCatalog = {
  keywords: [
    "False", "None", "True", "and", "as", "assert", "async", "await", "break", "class", "continue", "def", "del",
    "elif", "else", "except", "finally", "for", "from", "global", "if", "import", "in", "is", "lambda", "nonlocal",
    "not", "or", "pass", "raise", "return", "try", "while", "with", "yield",
  ],
  functionNames: ["solve", "main", "check", "dfs", "bfs", "binary_search", "dijkstra", "build", "query", "update", "read_ints"],
  loopNames: ["idx", "num", "item", "value", "key", "row", "col", "node", "edge", "testcase"],
  iterableFunctions: ["range", "enumerate", "zip", "reversed", "sorted", "iter", "map", "filter"],
  methods: {
    list: ["append", "extend", "pop", "sort", "reverse", "clear", "copy", "count", "index", "insert", "remove"],
    dict: ["get", "items", "keys", "values", "update", "setdefault", "pop", "popitem", "clear", "copy"],
    set: ["add", "discard", "remove", "update", "union", "intersection", "difference", "symmetric_difference", "copy", "clear", "pop"],
    str: ["split", "join", "strip", "startswith", "endswith", "replace", "find", "count", "lower", "upper", "isdigit"],
    tuple: ["count", "index"],
    bytes: ["split", "join", "strip", "startswith", "endswith", "decode", "find", "count"],
    int: ["bit_length", "bit_count", "to_bytes", "as_integer_ratio"],
    float: ["is_integer", "as_integer_ratio", "hex"],
  } satisfies Record<string, readonly string[]>,
  modules: {
    common: {
      sys: [
        ["stdin", "variable"], ["setrecursionlimit", "function"], ["stdout", "variable"], ["maxsize", "constant"],
        ["exit", "function"], ["argv", "variable"], ["stderr", "variable"],
      ],
      collections: [["deque", "type"], ["Counter", "type"], ["defaultdict", "type"], ["namedtuple", "function"]],
      heapq: [
        ["heappush", "function"], ["heappop", "function"], ["heapify", "function"], ["heappushpop", "function"],
        ["heapreplace", "function"], ["nlargest", "function"], ["nsmallest", "function"],
      ],
      bisect: [
        ["bisect_left", "function"], ["bisect_right", "function"], ["insort", "function"],
        ["insort_left", "function"], ["insort_right", "function"],
      ],
      math: [
        ["gcd", "function"], ["isqrt", "function"], ["inf", "constant"], ["lcm", "function"], ["ceil", "function"],
        ["floor", "function"], ["sqrt", "function"], ["comb", "function"], ["factorial", "function"],
        ["prod", "function"], ["log2", "function"], ["perm", "function"],
      ],
      itertools: [
        ["accumulate", "type"], ["combinations", "type"], ["permutations", "type"], ["product", "type"], ["chain", "type"],
        ["groupby", "type"], ["combinations_with_replacement", "type"], ["count", "type"], ["islice", "type"], ["repeat", "type"],
      ],
      functools: [["lru_cache", "function"], ["cache", "function"], ["cmp_to_key", "function"], ["reduce", "function"]],
    } satisfies SymbolTable,
    other: {
      operator: [["itemgetter", "type"], ["attrgetter", "type"]],
      array: [["array", "type"]],
      random: [["randint", "function"], ["randrange", "function"], ["sample", "function"], ["shuffle", "function"]],
      fractions: [["Fraction", "type"]],
      decimal: [["Decimal", "type"], ["getcontext", "function"]],
      "collections.abc": [["Iterable", "type"], ["Iterator", "type"], ["Mapping", "type"], ["Sequence", "type"]],
    } satisfies SymbolTable,
  },
  members: {
    "sys.stdin": [["readline", "method"], ["read", "method"], ["buffer", "property"], ["readlines", "method"]],
    "sys.stdin.buffer": [["read", "method"], ["readline", "method"], ["readlines", "method"]],
    "sys.stdout": [["write", "method"], ["flush", "method"], ["buffer", "property"], ["writelines", "method"]],
    "sys.stdout.buffer": [["write", "method"], ["flush", "method"], ["writelines", "method"]],
    "sys.stderr": [["write", "method"], ["flush", "method"], ["writelines", "method"]],
  } satisfies SymbolTable,
  commonSymbols: [
    "deque", "Counter", "defaultdict", "heappush", "heappop", "heapify", "bisect_left", "bisect_right", "gcd", "isqrt",
    "accumulate", "lru_cache", "cache", "combinations", "permutations", "product", "insort", "inf",
  ],
};

export const contestTemplates = {
  cpp: [
    { label: "!cpp", detail: "C++", lines: [
      "#include <bits/stdc++.h>",
      "using namespace std;",
      "",
      "int main() {",
      "\tios::sync_with_stdio(false);",
      "\tcin.tie(nullptr);",
      "",
      "\t${}",
      "\treturn 0;",
      "}",
    ] },
  ],
  python: [
    { label: "!py", detail: "Python", lines: [
      "import sys",
      "input = sys.stdin.readline",
      "",
      "def solve():",
      "\t${pass}",
      "",
      "",
      "t=1",
      "t=int(input())",
      "for t in range(t):",
      "\tsolve()",
    ] },
  ],
};

export const variableNames = {
  common: ["ans", "nums", "res", "arr", "dp", "cnt", "idx", "dist", "vis", "graph"],
  other: ["low", "high", "left", "right", "cur", "prev", "tmp", "total", "result"],
};

export const completionWeights = {
  imports: { rankedBonus: 24, pythonImportStatement: 15, pythonAutoImport: -25 },
  variables: {
    nearestBinding: 58,
    outerBinding: 28,
    scopePenalty: 5,
    maxOrderPenalty: 12,
    declarationName: 30,
    referenceName: -25,
    rankedBonus: 16,
  },
};
