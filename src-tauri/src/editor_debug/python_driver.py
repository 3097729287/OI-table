import bdb
import json
import os
import sys
import traceback
import types
from itertools import islice

MAX_ROWS = 128
MAX_REFERENCES = 2048
MAX_REFERENCE_DEPTH = 32
VALUE_BUDGET = 320 * 1024
MAX_VALUE_TEXT = 8 * 1024
MAX_LABEL_TEXT = 256

TYPE_NAME = type.__dict__["__name__"].__get__
TYPE_BASES = type.__dict__["__mro__"].__get__
TYPE_DICT = type.__dict__["__dict__"].__get__
MODULE_FIELDS = types.ModuleType.__dict__["__dict__"].__get__
FUNCTION_KINDS = (
    types.FunctionType, types.BuiltinFunctionType, types.MethodType,
    types.MethodDescriptorType, types.WrapperDescriptorType,
)


def redirect_program_streams():
    commands = os.fdopen(os.dup(0), "r", encoding="utf-8")
    responses = os.fdopen(os.dup(1), "w", encoding="utf-8", buffering=1)
    for stream, filename, mode in (
        (0, "input.txt", "rb"),
        (1, "output.txt", "wb"),
        (2, "error.txt", "wb"),
    ):
        with open(filename, mode) as file:
            os.dup2(file.fileno(), stream)
    sys.stdin = open(0, "r", encoding="utf-8", closefd=False)
    sys.stdout = open(1, "w", encoding="utf-8", errors="backslashreplace", buffering=1, closefd=False)
    sys.stderr = open(2, "w", encoding="utf-8", errors="backslashreplace", buffering=1, closefd=False)
    return commands, responses


def is_class(kind):
    return any(base is type for base in TYPE_BASES(kind))


def namespace_group(name, value):
    if name.startswith("__") and name.endswith("__"):
        return "special"
    kind = type(value)
    if any(kind is function for function in FUNCTION_KINDS):
        return "function"
    if is_class(kind):
        return "class"
    return None


def value_preview(value, depth=0):
    kind = type(value)
    if kind is str or kind is bytes:
        limit = 80 if depth else MAX_VALUE_TEXT
        return repr(value[:limit]) + ("…" if len(value) > limit else "")
    if any(kind is builtin for builtin in (bool, int, float, complex, type(None))):
        try:
            return repr(value)
        except ValueError:
            return "…"
    if kind is types.BuiltinFunctionType:
        return "".join(("<built-in ", value.__qualname__, ">"))
    if kind is types.FunctionType:
        return "".join(("<function ", value.__qualname__, ">"))
    if kind is types.MethodType:
        function = value.__func__
        name = function.__qualname__ if type(function) is types.FunctionType else TYPE_NAME(type(function))
        return "".join(("<bound method ", name, ">"))
    if kind is types.ModuleType:
        metadata = {
            name: item for name, item in MODULE_FIELDS(value).items()
            if type(name) is str and name in ("__name__", "__file__") and type(item) is str
        }
        name = metadata.get("__name__", "?")
        origin = metadata.get("__file__")
        return f"<module {name!r} from {origin!r}>" if origin else f"<module {name!r}>"
    if is_class(kind):
        return "".join(("<class ", TYPE_NAME(value), ">"))
    if not any(kind is builtin for builtin in (list, tuple, set, frozenset, dict)):
        return "".join(("<", TYPE_NAME(kind), ">"))
    if depth >= 2:
        return f"{TYPE_NAME(kind)}({len(value)})"
    left, right = {
        list: ("[", "]"),
        tuple: ("(", ")"),
        set: ("{", "}"),
        frozenset: ("frozenset({", "})"),
        dict: ("{", "}"),
    }[kind]
    parts = []
    for index, item in enumerate(value.items() if kind is dict else value):
        if index == 8:
            parts.append("…")
            break
        if kind is dict:
            key, item = item
            parts.append(value_preview(key, depth + 1) + ": " + value_preview(item, depth + 1))
        else:
            parts.append(value_preview(item, depth + 1))
    if (kind is set or kind is frozenset) and not parts:
        return f"{TYPE_NAME(kind)}()"
    return left + ", ".join(parts) + ("," if kind is tuple and len(value) == 1 else "") + right


def child_items(value):
    kind = type(value)
    if kind is dict:
        return ((f"[{value_preview(key, 1)}]", item) for key, item in value.items()) if value else None
    if any(kind is builtin for builtin in (list, tuple, set, frozenset)):
        return ((f"[{index}]", item) for index, item in enumerate(value)) if value else None
    if kind is types.ModuleType:
        return ((name, item) for name, item in MODULE_FIELDS(value).items() if type(name) is str)
    if kind is types.FunctionType:
        return None

    # Read the instance storage descriptor directly, bypassing custom attribute
    # access, properties, and representations defined by the running draft.
    bases = TYPE_BASES(kind)
    if any(base is type for base in bases):
        return None
    for base in bases:
        descriptor = TYPE_DICT(base).get("__dict__")
        if type(descriptor) is types.GetSetDescriptorType and descriptor.__objclass__ is base:
            fields = descriptor.__get__(value, kind)
            if type(fields) is dict and fields:
                return ((name, item) for name, item in fields.items() if type(name) is str)
            return None
    return None


def limit_wire_text(text, limit):
    # The debugger transport limits encoded JSON rather than Unicode code points.
    text = str.encode(text, "utf-8", "backslashreplace").decode("utf-8")
    if len(json.dumps(text)) <= limit:
        return text
    low, high = 0, min(len(text), limit)
    while low < high:
        middle = (low + high + 1) // 2
        if len(json.dumps(text[:middle] + "…")) <= limit:
            low = middle
        else:
            high = middle - 1
    return text[:low] + "…"


class Variables:
    def __init__(self):
        self.references = {}
        self.reference_ids = {}
        self.next_reference = 1

    def reset(self):
        self.references.clear()
        self.reference_ids.clear()

    def frame(self, frame):
        return {
            "globalsReference": self.reference(frame.f_globals, (), namespace=True),
            "variables": self.namespace(frame.f_locals),
        }

    def namespace(self, mapping, ancestors=()):
        items = ((name, value) for name, value in mapping.copy().items() if type(name) is str)
        return self.rows(items, ancestors, namespace=True)

    def reference(self, value, ancestors, namespace=False):
        identity = id(value)
        if len(ancestors) >= MAX_REFERENCE_DEPTH or identity in ancestors:
            return None
        key = (identity, ancestors, namespace)
        reference = self.reference_ids.get(key)
        if reference is not None:
            return reference
        if len(self.references) >= MAX_REFERENCES or (not namespace and child_items(value) is None):
            return None
        reference = self.next_reference
        self.next_reference += 1
        self.references[reference] = (value, (*ancestors, identity), namespace)
        self.reference_ids[key] = reference
        return reference

    def children(self, reference):
        entry = self.references.get(reference)
        if entry is not None:
            value, ancestors, namespace = entry
            try:
                if namespace:
                    return self.namespace(value, ancestors)
                return self.rows(child_items(value) or (), ancestors)
            except RuntimeError:
                pass
        return {"invalidReference": "These variable children are no longer available."}

    def rows(self, items, ancestors=(), namespace=False):
        items = list(islice(items, MAX_ROWS + 1))
        visible = items[:MAX_ROWS]
        value_limit = min(MAX_VALUE_TEXT, VALUE_BUDGET // max(1, len(visible)))
        result = []
        for name, value in visible:
            row = {"name": limit_wire_text(name, MAX_LABEL_TEXT)}
            try:
                row["type"] = limit_wire_text(TYPE_NAME(type(value)), MAX_LABEL_TEXT)
                if namespace:
                    group = namespace_group(name, value)
                    if group is not None:
                        row["group"] = group
                preview = (
                    f"dict({len(value)})"
                    if namespace and name == "__builtins__" and type(value) is dict
                    else value_preview(value)
                )
                row["value"] = limit_wire_text(preview, value_limit)
                reference = self.reference(value, ancestors)
                if reference is not None:
                    row["reference"] = reference
            except Exception:
                row.setdefault("type", "")
                row.setdefault("value", "…")
            result.append(row)
        if len(items) > MAX_ROWS:
            result.append({"name": "…", "value": "", "type": ""})
        return result


class Debugger(bdb.Bdb):
    def __init__(self, source, commands, responses, breakpoints):
        super().__init__()
        self.source = self.canonic(source)
        self.commands = commands
        self.responses = responses
        self.first_line = True
        self.breakpoints = breakpoints
        self.variables = Variables()
        self.set_breakpoints(breakpoints)

    def set_breakpoints(self, breakpoints):
        self.clear_all_breaks()
        for line in breakpoints:
            self.set_break(self.source, line)

    def in_draft(self, frame):
        return frame is not None and self.canonic(frame.f_code.co_filename) == self.source

    def stop_here(self, frame):
        return self.in_draft(frame) and super().stop_here(frame)

    def user_line(self, frame):
        at_breakpoint = self.get_break(self.source, frame.f_lineno)
        if self.first_line:
            self.first_line = False
            if self.breakpoints and not at_breakpoint:
                self.set_continue()
                return
            reason = "breakpoint" if at_breakpoint else "entry"
        else:
            reason = "breakpoint" if at_breakpoint else "step"

        stack = []
        caller = frame
        while caller is not None and len(stack) < 64:
            if self.in_draft(caller):
                stack.append(caller)
            caller = caller.f_back
        self.respond({
            "status": "paused",
            "reason": reason,
            "line": frame.f_lineno,
            "frames": [
                {"id": index, "name": limit_wire_text(caller.f_code.co_name, MAX_LABEL_TEXT), "line": caller.f_lineno}
                for index, caller in enumerate(stack)
            ],
            **self.variables.frame(frame),
        })
        for line in self.commands:
            request = json.loads(line)
            if "frame" in request:
                self.respond(self.variables.frame(stack[request["frame"]]))
                continue
            if "reference" in request:
                self.respond(self.variables.children(request["reference"]))
                continue
            self.variables.reset()
            self.set_breakpoints(request["breakpoints"])
            action = request["action"]
            if action == "stepInto":
                self.set_step()
            elif action == "stepOver":
                self.set_next(frame)
            elif action == "stepOut":
                self.set_return(frame)
            else:
                self.set_continue()
            return
        self.set_quit()

    def user_return(self, frame, _value):
        if not self.in_draft(frame):
            return
        caller = frame.f_back
        if self.in_draft(caller):
            self.set_next(caller)
        else:
            self.set_continue()

    def respond(self, result):
        sys.stdout.flush()
        sys.stderr.flush()
        self.responses.write(json.dumps(result) + "\n")


def main():
    commands, responses = redirect_program_streams()
    source = os.path.abspath("solution.py")
    try:
        with open(source, "rb") as file:
            program = compile(file.read(), "solution.py", "exec")
    except SyntaxError as error:
        responses.write(json.dumps({"compileError": "".join(traceback.format_exception_only(error))}) + "\n")
        return
    startup = commands.readline()
    if not startup:
        return
    # The relative filename also keeps temporary workspace paths out of program tracebacks.
    debugger = Debugger("solution.py", commands, responses, json.loads(startup)["breakpoints"])
    sys.argv = ["solution.py"]
    script = types.ModuleType("__main__")
    script.__file__ = source
    sys.modules["__main__"] = script
    reason = "exited"
    try:
        debugger.run(program, script.__dict__)
    except SystemExit as error:
        if error.code not in (None, 0):
            print(error.code, file=sys.stderr)
            reason = "exception"
    except BaseException as error:
        traceback.print_exception(type(error), error, error.__traceback__.tb_next.tb_next)
        reason = "exception"
    debugger.respond({"status": "finished", "reason": reason, "line": None, "frames": [], "variables": []})


if __name__ == "__main__":
    main()
