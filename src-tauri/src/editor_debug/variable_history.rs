use std::{
    collections::{HashMap, VecDeque},
    time::{Duration, Instant},
};

use super::{DebugFrameVariables, DebugVariable, DebugVariableValue, Result};

const SNAPSHOT_BUDGET: Duration = Duration::from_millis(250);
const MAX_SNAPSHOT_BRANCHES: usize = 24;
const MAX_SNAPSHOT_ROWS: usize = 384;
const MAX_SNAPSHOT_DEPTH: usize = 4;

#[derive(Default)]
struct VariableSnapshot {
    frame: Vec<String>,
    variables: Vec<DebugVariable>,
    globals: Option<u32>,
    children: HashMap<u32, Vec<DebugVariable>>,
}

#[derive(Default)]
pub(super) struct VariableHistory {
    current: VariableSnapshot,
    previous: VariableSnapshot,
    previous_references: HashMap<u32, Option<u32>>,
}

impl VariableHistory {
    pub(super) fn remember(
        &mut self,
        mut read: impl FnMut(u32) -> Result<Vec<DebugVariable>>,
    ) -> Result<()> {
        let mut previous = std::mem::take(&mut self.current);
        let mut inspected = std::mem::take(&mut previous.children);
        let mut pending = VecDeque::new();
        pending.extend(previous.globals.map(|reference| (reference, 1)));
        pending.extend(expandable_references(&previous.variables, 1));
        let deadline = Instant::now() + SNAPSHOT_BUDGET;
        let mut remaining = MAX_SNAPSHOT_ROWS;
        while let Some((reference, depth)) = pending.pop_front() {
            if remaining == 0 || previous.children.len() == MAX_SNAPSHOT_BRANCHES {
                break;
            }
            if previous.children.contains_key(&reference) {
                continue;
            }
            let mut children = match inspected.remove(&reference) {
                Some(children) => children,
                None if Instant::now() >= deadline => continue,
                None => match read(reference) {
                    Ok(children) => children,
                    Err(error) if error.code == "invalid_request" => continue,
                    Err(error) => return Err(error),
                },
            };
            children.truncate(remaining);
            remaining -= children.len();
            if depth < MAX_SNAPSHOT_DEPTH {
                pending.extend(expandable_references(&children, depth + 1));
            }
            previous.children.insert(reference, children);
        }
        self.previous = previous;
        Ok(())
    }

    pub(super) fn show(&mut self, frame: Vec<String>, scope: &mut DebugFrameVariables) {
        self.previous_references.clear();
        if !frame.is_empty() && frame == self.previous.frame {
            if let Some(reference) = scope.globals_reference {
                self.previous_references
                    .insert(reference, self.previous.globals);
            }
            compare_variables(
                &self.previous.variables,
                &mut scope.variables,
                &mut self.previous_references,
            );
        }
        self.current = VariableSnapshot {
            frame,
            variables: scope.variables.clone(),
            globals: scope.globals_reference,
            children: HashMap::new(),
        };
    }

    pub(super) fn compare_children(&mut self, reference: u32, variables: &mut [DebugVariable]) {
        if self.current.children.len() < MAX_SNAPSHOT_BRANCHES {
            self.current
                .children
                .entry(reference)
                .or_insert_with(|| variables.to_vec());
        }
        let previous = self
            .previous_references
            .get(&reference)
            .copied()
            .flatten()
            .and_then(|reference| self.previous.children.get(&reference));
        if let Some(previous) = previous {
            compare_variables(previous, variables, &mut self.previous_references);
        }
    }
}

fn expandable_references(
    variables: &[DebugVariable],
    depth: usize,
) -> impl Iterator<Item = (u32, usize)> + '_ {
    variables.iter().filter_map(move |variable| {
        // Inspect user data first. Special variables often lead into runtime internals.
        if variable.group.is_some() || variable.r#type == "module" {
            return None;
        }
        variable.reference.map(|reference| (reference, depth))
    })
}

fn compare_variables(
    previous: &[DebugVariable],
    current: &mut [DebugVariable],
    references: &mut HashMap<u32, Option<u32>>,
) {
    let mut by_name = HashMap::new();
    for variable in previous {
        by_name
            .entry((variable.group, variable.name.as_str()))
            .or_insert_with(VecDeque::new)
            .push_back(variable);
    }
    for variable in current {
        let old = by_name
            .get_mut(&(variable.group, variable.name.as_str()))
            .and_then(VecDeque::pop_front);
        if let Some(reference) = variable.reference {
            let old_reference = old.and_then(|old| old.reference);
            references
                .entry(reference)
                .and_modify(|matched| {
                    if *matched != old_reference {
                        *matched = None;
                    }
                })
                .or_insert(old_reference);
        }
        if let Some(old) = old {
            if old.value != variable.value || old.r#type != variable.r#type {
                variable.previous = Some(DebugVariableValue {
                    value: old.value.clone(),
                    r#type: old.r#type.clone(),
                });
            }
        }
    }
}
