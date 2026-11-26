use std::{collections::BTreeMap, time::Instant};

use super::{mi, ActiveDebug, DebugError, DebugFrameVariables, DebugVariable, Debugger, Result};

pub(super) const MAX_CHILDREN: usize = 100;
const MAX_REFERENCES: usize = 4096;

#[derive(Clone, PartialEq, Eq, PartialOrd, Ord)]
enum VariableTarget {
    Globals {
        frame: u32,
    },
    Expression {
        frame: u32,
        expression: String,
        vector: bool,
    },
    Child {
        frame: u32,
        name: String,
        vector: bool,
        dynamic: bool,
    },
}

impl VariableTarget {
    fn frame(&self) -> u32 {
        match self {
            Self::Globals { frame }
            | Self::Expression { frame, .. }
            | Self::Child { frame, .. } => *frame,
        }
    }
}

#[derive(Clone)]
enum ChildSource {
    Globals,
    Empty,
    Object { name: String, truncated: bool },
}

#[derive(Default)]
pub(super) struct VariableTable {
    last_id: u32,
    ids: BTreeMap<VariableTarget, u32>,
    targets: BTreeMap<u32, VariableTarget>,
    resolved: BTreeMap<u32, ChildSource>,
    roots: Vec<String>,
}

impl VariableTable {
    fn register(&mut self, target: VariableTarget) -> Option<u32> {
        if let Some(id) = self.ids.get(&target) {
            return Some(*id);
        }
        if self.targets.len() >= MAX_REFERENCES {
            return None;
        }
        self.last_id = self.last_id.checked_add(1)?;
        self.ids.insert(target.clone(), self.last_id);
        self.targets.insert(self.last_id, target);
        Some(self.last_id)
    }
}

impl Debugger {
    pub(super) fn clear_variables(
        &mut self,
        deadline: Instant,
        active: &ActiveDebug,
    ) -> Result<()> {
        let table = &mut self.variables;
        table.ids.clear();
        table.targets.clear();
        table.resolved.clear();
        for root in std::mem::take(&mut self.variables.roots) {
            self.exchange(
                &format!("-var-delete {}", mi::argument(&root)),
                deadline,
                active,
            )?;
        }
        Ok(())
    }

    pub(super) fn variables(
        &mut self,
        frame: u32,
        deadline: Instant,
        active: &ActiveDebug,
    ) -> Result<DebugFrameVariables> {
        let (values, types) = self.in_frame(frame, deadline, active, |debugger| {
            Ok((
                debugger.command("-stack-list-variables --all-values", deadline, active)?,
                debugger.command("-stack-list-variables --simple-values", deadline, active)?,
            ))
        })?;
        let variables = values
            .list("variables")
            .zip(types.list("variables"))
            .take(128)
            .filter_map(|(value, typed)| {
                let name = value.string("name")?;
                let value = value.string("value").unwrap_or("…");
                let kind = typed.string("type").unwrap_or_default();
                Some(self.expression_variable(frame, name, name, kind, value))
            })
            .collect();
        Ok(DebugFrameVariables {
            variables,
            globals_reference: self.variables.register(VariableTarget::Globals { frame }),
        })
    }

    pub(super) fn expression_variable(
        &mut self,
        frame: u32,
        name: &str,
        expression: &str,
        kind: &str,
        value: &str,
    ) -> DebugVariable {
        let libstdcpp_storage_preview = value.starts_with("{<std::_Vector_base");
        let vector = is_vector(kind) || libstdcpp_storage_preview;
        let reference = if expandable(kind, value) {
            self.variables.register(VariableTarget::Expression {
                frame,
                expression: expression.into(),
                vector,
            })
        } else {
            None
        };
        let value = if libstdcpp_storage_preview {
            "{…}"
        } else {
            value
        };
        variable(name, value, kind, reference)
    }

    pub(super) fn variable_children(
        &mut self,
        reference: u32,
        deadline: Instant,
        active: &ActiveDebug,
    ) -> Result<Vec<DebugVariable>> {
        let target = self
            .variables
            .targets
            .get(&reference)
            .cloned()
            .ok_or_else(|| {
                DebugError::invalid("The requested variable is unavailable at this pause.")
            })?;
        self.in_frame(target.frame(), deadline, active, |debugger| {
            let source = if let Some(source) = debugger.variables.resolved.get(&reference) {
                source.clone()
            } else {
                let source = debugger.resolve_variable(reference, &target, deadline, active)?;
                debugger
                    .variables
                    .resolved
                    .insert(reference, source.clone());
                source
            };
            match source {
                ChildSource::Globals => debugger.global_variables(target.frame(), deadline, active),
                ChildSource::Empty => Ok(Vec::new()),
                ChildSource::Object { name, truncated } => {
                    debugger.list_children(&name, target.frame(), truncated, deadline, active)
                }
            }
        })
    }

    fn resolve_variable(
        &mut self,
        reference: u32,
        target: &VariableTarget,
        deadline: Instant,
        active: &ActiveDebug,
    ) -> Result<ChildSource> {
        let name = match target {
            VariableTarget::Globals { .. } => return Ok(ChildSource::Globals),
            VariableTarget::Expression {
                expression, vector, ..
            } => {
                let name = format!("oi{reference}");
                let Some(created) = self.create_object(&name, expression, deadline, active)? else {
                    return Ok(ChildSource::Empty);
                };
                if *vector && created.number("dynamic") != Some(1) {
                    if let Some(listing) =
                        self.vector_source(reference, expression, deadline, active)?
                    {
                        return Ok(listing);
                    }
                }
                name
            }
            VariableTarget::Child {
                name,
                vector,
                dynamic,
                ..
            } => {
                if *vector && !dynamic {
                    let reply = self.exchange(
                        &format!("-var-info-path-expression {}", mi::argument(name)),
                        deadline,
                        active,
                    )?;
                    if let Some(expression) = reply.values.string("path_expr") {
                        if let Some(listing) =
                            self.vector_source(reference, expression, deadline, active)?
                        {
                            return Ok(listing);
                        }
                    }
                }
                name.clone()
            }
        };
        Ok(ChildSource::Object {
            name,
            truncated: false,
        })
    }

    fn vector_source(
        &mut self,
        reference: u32,
        expression: &str,
        deadline: Instant,
        active: &ActiveDebug,
    ) -> Result<Option<ChildSource>> {
        // Old GDB builds may lack libstdc++'s pretty-printer. Read the vector's
        // contiguous elements through an artificial array without executing draft code.
        let storage = format!("({expression})._M_impl");
        let length = format!("{storage}._M_finish - {storage}._M_start");
        let reply = self.exchange(
            &format!("-data-evaluate-expression {}", mi::argument(&length)),
            deadline,
            active,
        )?;
        let Some(length) = reply
            .values
            .string("value")
            .and_then(|value| value.parse::<usize>().ok())
        else {
            return Ok(None);
        };
        if length == 0 {
            return Ok(Some(ChildSource::Empty));
        }
        let name = format!("oivector{reference}");
        let array = format!("(*{storage}._M_start)@{}", length.min(MAX_CHILDREN));
        let Some(_) = self.create_object(&name, &array, deadline, active)? else {
            return Ok(None);
        };
        Ok(Some(ChildSource::Object {
            name,
            truncated: length > MAX_CHILDREN,
        }))
    }

    fn create_object(
        &mut self,
        name: &str,
        expression: &str,
        deadline: Instant,
        active: &ActiveDebug,
    ) -> Result<Option<mi::Value>> {
        let reply = self.exchange(
            &format!("-var-create {name} * {}", mi::argument(expression)),
            deadline,
            active,
        )?;
        if reply.class != "done" {
            return Ok(None);
        }
        self.variables.roots.push(name.into());
        Ok(Some(reply.values))
    }

    fn list_children(
        &mut self,
        name: &str,
        frame: u32,
        mut truncated: bool,
        deadline: Instant,
        active: &ActiveDebug,
    ) -> Result<Vec<DebugVariable>> {
        let reply = self.query_children(name, MAX_CHILDREN, deadline, active)?;
        truncated |= reply.number("has_more") == Some(1);
        let mut rows = Vec::new();
        for child in reply.list("children") {
            if rows.len() == MAX_CHILDREN {
                truncated = true;
                break;
            }
            if child.string("type").is_none()
                && matches!(
                    child.string("exp"),
                    Some("public" | "protected" | "private")
                )
            {
                if let Some(name) = child.string("name") {
                    let remaining = MAX_CHILDREN - rows.len();
                    let members = self.query_children(name, remaining, deadline, active)?;
                    truncated |= members.number("has_more") == Some(1);
                    rows.extend(
                        members
                            .list("children")
                            .take(remaining)
                            .filter_map(|member| self.child_variable(member, frame)),
                    );
                }
            } else if let Some(row) = self.child_variable(child, frame) {
                rows.push(row);
            }
        }
        if truncated {
            rows.push(variable("…", "", "", None));
        }
        Ok(rows)
    }

    fn query_children(
        &mut self,
        name: &str,
        limit: usize,
        deadline: Instant,
        active: &ActiveDebug,
    ) -> Result<mi::Value> {
        let reply = self.exchange(
            &format!(
                "-var-list-children --all-values {} 0 {limit}",
                mi::argument(name)
            ),
            deadline,
            active,
        )?;
        if reply.class != "done" {
            return Err(DebugError::invalid(
                "The variable's children are unavailable.",
            ));
        }
        Ok(reply.values)
    }

    fn child_variable(&mut self, child: &mi::Value, frame: u32) -> Option<DebugVariable> {
        let name = child.string("exp")?;
        let kind = child.string("type").unwrap_or_default();
        let value = child.string("value").unwrap_or("…");
        let dynamic = child.number("dynamic") == Some(1);
        let expandable = dynamic
            || child.number("numchild").is_some_and(|count| count > 0)
            || child.number("has_more") == Some(1);
        let reference = if expandable {
            child.string("name").and_then(|name| {
                self.variables.register(VariableTarget::Child {
                    frame,
                    name: name.into(),
                    vector: is_vector(kind),
                    dynamic,
                })
            })
        } else {
            None
        };
        let name = match name.parse::<u32>() {
            Ok(index) => format!("[{index}]"),
            Err(_) => name.into(),
        };
        Some(variable(&name, value, kind, reference))
    }
}

pub(super) fn variable(
    name: &str,
    value: &str,
    kind: &str,
    reference: Option<u32>,
) -> DebugVariable {
    DebugVariable {
        name: name.chars().take(160).collect(),
        value: value.chars().take(1024).collect(),
        r#type: kind.chars().take(160).collect(),
        reference,
        group: None,
        previous: None,
    }
}

fn expandable(kind: &str, value: &str) -> bool {
    let kind = kind
        .trim_start_matches("const ")
        .trim_end_matches([' ', '&']);
    let value = value.trim_start();
    kind.ends_with(']')
        || value.starts_with('{')
        || (value.starts_with('@') && value.contains(": {"))
        || [
            "vector",
            "array",
            "deque",
            "list",
            "forward_list",
            "map",
            "unordered_map",
            "multimap",
            "unordered_multimap",
            "set",
            "unordered_set",
            "multiset",
            "unordered_multiset",
            "pair",
            "tuple",
            "optional",
        ]
        .iter()
        .any(|container| {
            kind.strip_prefix("std::")
                .and_then(|kind| kind.strip_prefix(container))
                .is_some_and(|parameters| parameters.starts_with('<'))
        })
}

fn is_vector(kind: &str) -> bool {
    kind.trim_start_matches("const ")
        .starts_with("std::vector<")
}
