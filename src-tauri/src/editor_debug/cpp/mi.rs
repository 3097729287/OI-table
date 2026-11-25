use super::super::{DebugError, Result};

pub(super) struct Record {
    pub(super) class: String,
    pub(super) values: Value,
}

pub(super) enum Value {
    Text(String),
    Tuple(Vec<(String, Value)>),
    List(Vec<Value>),
}

impl Value {
    pub(super) fn get(&self, key: &str) -> Option<&Self> {
        match self {
            Self::Tuple(fields) => fields
                .iter()
                .find(|(name, _)| name == key)
                .map(|(_, value)| value),
            _ => None,
        }
    }

    pub(super) fn string(&self, key: &str) -> Option<&str> {
        match self.get(key)? {
            Self::Text(value) => Some(value),
            _ => None,
        }
    }

    pub(super) fn number(&self, key: &str) -> Option<u32> {
        self.string(key)?.parse().ok()
    }

    pub(super) fn list(&self, key: &str) -> impl Iterator<Item = &Self> {
        match self.get(key) {
            Some(Self::List(entries)) => entries.iter(),
            _ => [].iter(),
        }
    }
}

pub(super) fn record(input: &str) -> Result<Record> {
    let (class, input) = input.split_once(',').unwrap_or((input, ""));
    Ok(Record {
        class: class.to_owned(),
        values: fields(input)?,
    })
}

pub(super) fn fields(input: &str) -> Result<Value> {
    let input = input.strip_prefix(',').unwrap_or(input);
    let mut parser = Parser {
        bytes: input.as_bytes(),
        offset: 0,
    };
    Ok(Value::Tuple(parser.tuple(None, 0)?))
}

pub(super) fn argument(input: &str) -> String {
    // MI accepts a quoted string for parameters containing spaces or punctuation.
    serde_json::Value::String(input.into()).to_string()
}

pub(super) fn console_text(input: &str) -> Option<String> {
    let mut parser = Parser {
        bytes: input.as_bytes(),
        offset: 0,
    };
    match parser.value(0).ok()? {
        Value::Text(text) => Some(text),
        _ => None,
    }
}

struct Parser<'a> {
    bytes: &'a [u8],
    offset: usize,
}

impl Parser<'_> {
    fn tuple(&mut self, end: Option<u8>, depth: usize) -> Result<Vec<(String, Value)>> {
        let mut fields = Vec::new();
        while self.peek() != end {
            let name = self.identifier()?;
            self.take(b'=')?;
            fields.push((name, self.value(depth + 1)?));
            if self.peek() == end {
                break;
            }
            self.take(b',')?;
        }
        if let Some(byte) = end {
            self.take(byte)?;
        }
        Ok(fields)
    }

    fn list(&mut self, depth: usize) -> Result<Vec<Value>> {
        let mut values = Vec::new();
        while self.peek() != Some(b']') {
            if matches!(self.peek(), Some(byte) if byte.is_ascii_alphabetic()) {
                // MI lists can contain unnamed values or repeated results, e.g. frame={...}.
                self.identifier()?;
                self.take(b'=')?;
            }
            values.push(self.value(depth + 1)?);
            if self.peek() == Some(b']') {
                break;
            }
            self.take(b',')?;
        }
        self.take(b']')?;
        Ok(values)
    }

    fn value(&mut self, depth: usize) -> Result<Value> {
        if depth > 24 {
            return Err(invalid_record());
        }
        match self.next() {
            Some(b'"') => self.text().map(Value::Text),
            Some(b'{') => self.tuple(Some(b'}'), depth).map(Value::Tuple),
            Some(b'[') => self.list(depth).map(Value::List),
            _ => Err(invalid_record()),
        }
    }

    fn text(&mut self) -> Result<String> {
        let mut value = Vec::new();
        loop {
            match self.next() {
                Some(b'"') => return Ok(String::from_utf8_lossy(&value).into_owned()),
                Some(b'\\') => value.push(self.escaped()?),
                Some(byte) => value.push(byte),
                None => return Err(invalid_record()),
            }
        }
    }

    fn escaped(&mut self) -> Result<u8> {
        Ok(match self.next().ok_or_else(invalid_record)? {
            b'n' => b'\n',
            b'r' => b'\r',
            b't' => b'\t',
            b'a' => 7,
            b'b' => 8,
            b'f' => 12,
            b'v' => 11,
            digit @ b'0'..=b'7' => {
                let mut value = digit - b'0';
                for _ in 0..2 {
                    let Some(next @ b'0'..=b'7') = self.peek() else {
                        break;
                    };
                    self.next();
                    value = value.wrapping_mul(8).wrapping_add(next - b'0');
                }
                value
            }
            byte => byte,
        })
    }

    fn identifier(&mut self) -> Result<String> {
        let start = self.offset;
        while self
            .peek()
            .is_some_and(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
        {
            self.offset += 1;
        }
        if self.offset == start {
            return Err(invalid_record());
        }
        Ok(String::from_utf8_lossy(&self.bytes[start..self.offset]).into_owned())
    }

    fn peek(&self) -> Option<u8> {
        self.bytes.get(self.offset).copied()
    }

    fn next(&mut self) -> Option<u8> {
        let byte = self.peek()?;
        self.offset += 1;
        Some(byte)
    }

    fn take(&mut self, expected: u8) -> Result<()> {
        if self.next() == Some(expected) {
            return Ok(());
        }
        Err(invalid_record())
    }
}

fn invalid_record() -> DebugError {
    DebugError::failed("GDB returned an invalid response.")
}
