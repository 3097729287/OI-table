use std::time::Instant;

use super::{
    is_draft_file, mi,
    variables::{variable, MAX_CHILDREN},
    ActiveDebug, DebugError, DebugVariable, Debugger, Result,
};

const MAX_SYMBOL_LINE_BYTES: usize = 4096;

#[derive(Clone, Default)]
pub(super) struct DraftGlobals {
    symbols: Vec<GlobalSymbol>,
    truncated: bool,
}

#[derive(Clone)]
struct GlobalSymbol {
    name: String,
    kind: String,
}

impl Debugger {
    pub(super) fn global_variables(
        &mut self,
        frame: u32,
        deadline: Instant,
        active: &ActiveDebug,
    ) -> Result<Vec<DebugVariable>> {
        let globals = match &self.globals {
            Some(globals) => globals.clone(),
            None => {
                let mut scan = GlobalScan::default();
                // The console command also works on GDB versions predating
                // -symbol-info-variables. Its output is consumed incrementally.
                let result = self.exchange_with_console(
                    r#"-interpreter-exec console "info variables""#,
                    deadline,
                    active,
                    |chunk| scan.push(chunk),
                )?;
                if result.class != "done" {
                    return Err(DebugError::invalid("Global symbols are unavailable."));
                }
                self.globals = Some(scan.globals.clone());
                scan.globals
            }
        };
        let mut variables = Vec::with_capacity(globals.symbols.len());
        for symbol in globals.symbols {
            // The leading :: resolves the global even if a local has the same name.
            let expression = format!("::{}", symbol.name);
            let result = self.exchange(
                &format!("-data-evaluate-expression {}", mi::argument(&expression)),
                deadline,
                active,
            )?;
            if let Some(value) = result.values.string("value") {
                variables.push(self.expression_variable(
                    frame,
                    &symbol.name,
                    &expression,
                    &symbol.kind,
                    value,
                ));
            }
        }
        if globals.truncated {
            variables.push(variable("…", "", "", None));
        }
        Ok(variables)
    }
}

#[derive(Default)]
struct GlobalScan {
    pending: String,
    in_draft: bool,
    globals: DraftGlobals,
}

impl GlobalScan {
    fn push(&mut self, mut text: &str) {
        // One console line may span several separate MI stream records.
        while let Some((line, rest)) = text.split_once('\n') {
            if self.pending.len() + line.len() <= MAX_SYMBOL_LINE_BYTES {
                self.pending.push_str(line);
                let line = std::mem::take(&mut self.pending);
                self.observe(line.trim());
            } else {
                self.pending.clear();
            }
            text = rest;
        }
        if self.pending.len() + text.len() <= MAX_SYMBOL_LINE_BYTES {
            self.pending.push_str(text);
        } else {
            self.pending.clear();
        }
    }

    fn observe(&mut self, line: &str) {
        if let Some(header) = line.strip_suffix(':') {
            self.in_draft = header.strip_prefix("File ").is_some_and(is_draft_file);
            return;
        }
        if !self.in_draft {
            return;
        }
        let Some(symbol) = declaration(line) else {
            return;
        };
        if self
            .globals
            .symbols
            .iter()
            .any(|known| known.name == symbol.name)
        {
            return;
        }
        if self.globals.symbols.len() < MAX_CHILDREN {
            self.globals.symbols.push(symbol);
        } else {
            self.globals.truncated = true;
        }
    }
}

fn declaration(line: &str) -> Option<GlobalSymbol> {
    let line = line.strip_suffix(';')?.trim();
    let line = match line.split_once(':') {
        Some((digits, rest))
            if !digits.is_empty() && digits.bytes().all(|digit| digit.is_ascii_digit()) =>
        {
            rest.trim()
        }
        _ => line,
    };
    let (base, dimensions) = match line.split_once('[') {
        Some((base, dimensions)) if line.ends_with(']') => {
            (base.trim_end(), format!(" [{dimensions}"))
        }
        _ => (line, String::new()),
    };
    let split = base
        .char_indices()
        .rev()
        .find(|(_, character)| !character.is_alphanumeric() && !matches!(character, '_' | ':'))
        .map(|(index, character)| index + character.len_utf8())?;
    let name = &base[split..];
    if !name.split("::").all(identifier) {
        return None;
    }
    let kind = base[..split].trim().trim_start_matches("static ");
    Some(GlobalSymbol {
        name: name.into(),
        kind: format!("{kind}{dimensions}"),
    })
}

fn identifier(name: &str) -> bool {
    let mut characters = name.chars();
    characters
        .next()
        .is_some_and(|first| first == '_' || first.is_alphabetic())
        && characters.all(|character| character == '_' || character.is_alphanumeric())
}
