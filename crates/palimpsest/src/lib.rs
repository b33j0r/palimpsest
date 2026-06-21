use pest::RuleType;
use pest::iterators::{Pair, Pairs};
use serde::Serialize;
use serde_json::json;

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct HighlightToken {
    pub capture: String,
    pub start: usize,
    pub end: usize,
    pub start_utf16: usize,
    pub end_utf16: usize,
    pub start_line: usize,
    pub start_col: usize,
    pub end_line: usize,
    pub end_col: usize,
    pub text: String,
}

pub fn pest_tokens<R, F>(
    source: &str,
    pairs: Pairs<'_, R>,
    capture_for_rule: F,
) -> Vec<HighlightToken>
where
    R: RuleType,
    F: Fn(R) -> Option<&'static str> + Copy,
{
    let mut tokens = Vec::new();

    for pair in pairs {
        collect_pest_tokens(source, pair, &capture_for_rule, &mut tokens);
    }

    tokens
}

pub fn parse_success_json(tokens: &[HighlightToken]) -> String {
    json!({
        "ok": true,
        "tokens": tokens,
    })
    .to_string()
}

pub fn parse_error_json(error: impl ToString) -> String {
    json!({
        "ok": false,
        "error": error.to_string(),
    })
    .to_string()
}

fn collect_pest_tokens<R, F>(
    source: &str,
    pair: Pair<'_, R>,
    capture_for_rule: &F,
    tokens: &mut Vec<HighlightToken>,
) where
    R: RuleType,
    F: Fn(R) -> Option<&'static str> + Copy,
{
    if let Some(capture) = capture_for_rule(pair.as_rule()) {
        tokens.push(token_from_pair(source, capture, &pair));
    }

    for child in pair.into_inner() {
        collect_pest_tokens(source, child, capture_for_rule, tokens);
    }
}

fn token_from_pair<R>(source: &str, capture: &str, pair: &Pair<'_, R>) -> HighlightToken
where
    R: RuleType,
{
    let span = pair.as_span();
    let start = span.start();
    let end = span.end();
    token_from_byte_range(source, capture, start, end)
}

pub fn token_from_byte_range(
    source: &str,
    capture: &str,
    start: usize,
    end: usize,
) -> HighlightToken {
    let (start_line, start_col) = line_col(source, start);
    let (end_line, end_col) = line_col(source, end);

    HighlightToken {
        capture: capture.to_string(),
        start,
        end,
        start_utf16: utf16_offset(source, start),
        end_utf16: utf16_offset(source, end),
        start_line,
        start_col,
        end_line,
        end_col,
        text: source[start..end].to_string(),
    }
}

fn utf16_offset(source: &str, byte_offset: usize) -> usize {
    source[..byte_offset].encode_utf16().count()
}

fn line_col(source: &str, byte_offset: usize) -> (usize, usize) {
    let mut line = 1;
    let mut col = 1;

    for ch in source[..byte_offset].chars() {
        if ch == '\n' {
            line += 1;
            col = 1;
        } else {
            col += 1;
        }
    }

    (line, col)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn utf16_offsets_count_surrogate_pairs() {
        assert_eq!(utf16_offset("a💸b", 0), 0);
        assert_eq!(utf16_offset("a💸b", 1), 1);
        assert_eq!(utf16_offset("a💸b", "a💸".len()), 3);
        assert_eq!(utf16_offset("a💸b", "a💸b".len()), 4);
    }

    #[test]
    fn byte_range_tokens_include_position_metadata() {
        let token = token_from_byte_range("one\n💸two", "symbol", "one\n".len(), "one\n💸".len());

        assert_eq!(token.text, "💸");
        assert_eq!(token.start_line, 2);
        assert_eq!(token.start_col, 1);
        assert_eq!(token.end_line, 2);
        assert_eq!(token.end_col, 2);
        assert_eq!(token.start_utf16, 4);
        assert_eq!(token.end_utf16, 6);
    }
}
