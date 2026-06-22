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

pub struct TokenSink<'a> {
    source: &'a str,
    tokens: Vec<HighlightToken>,
}

impl<'a> TokenSink<'a> {
    pub fn new(source: &'a str) -> Self {
        Self {
            source,
            tokens: Vec::new(),
        }
    }

    pub fn source(&self) -> &'a str {
        self.source
    }

    pub fn tokens(&self) -> &[HighlightToken] {
        &self.tokens
    }

    pub fn tokens_mut(&mut self) -> &mut Vec<HighlightToken> {
        &mut self.tokens
    }

    pub fn push_range(&mut self, capture: &str, start: usize, end: usize) {
        push_range(self.source, capture, start, end, &mut self.tokens);
    }

    pub fn push_char_between(&mut self, capture: &str, needle: char, start: usize, end: usize) {
        push_char_between(self.source, capture, needle, start, end, &mut self.tokens);
    }

    pub fn push_char_between_rev(&mut self, capture: &str, needle: char, start: usize, end: usize) {
        push_char_between_rev(self.source, capture, needle, start, end, &mut self.tokens);
    }

    pub fn push_char_before(&mut self, capture: &str, needle: char, end: usize, floor: usize) {
        push_char_before(self.source, capture, needle, end, floor, &mut self.tokens);
    }

    pub fn push_char_after(&mut self, capture: &str, needle: char, start: usize, ceiling: usize) {
        push_char_after(
            self.source,
            capture,
            needle,
            start,
            ceiling,
            &mut self.tokens,
        );
    }

    pub fn push_char_at_or_before(
        &mut self,
        capture: &str,
        needle: char,
        end: usize,
        floor: usize,
    ) {
        push_char_at_or_before(self.source, capture, needle, end, floor, &mut self.tokens);
    }

    pub fn push_char_at_or_after(
        &mut self,
        capture: &str,
        needle: char,
        start: usize,
        ceiling: usize,
    ) {
        push_char_at_or_after(
            self.source,
            capture,
            needle,
            start,
            ceiling,
            &mut self.tokens,
        );
    }

    pub fn sort_and_dedupe(&mut self) {
        sort_and_dedupe(&mut self.tokens);
    }

    pub fn into_tokens(mut self) -> Vec<HighlightToken> {
        self.sort_and_dedupe();
        self.tokens
    }
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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PestPunctuationPosition {
    First,
    Last,
    Before,
    After,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PestPunctuation {
    pub capture: &'static str,
    pub ch: char,
    pub position: PestPunctuationPosition,
}

impl PestPunctuation {
    pub const fn first(capture: &'static str, ch: char) -> Self {
        Self {
            capture,
            ch,
            position: PestPunctuationPosition::First,
        }
    }

    pub const fn last(capture: &'static str, ch: char) -> Self {
        Self {
            capture,
            ch,
            position: PestPunctuationPosition::Last,
        }
    }

    pub const fn before(capture: &'static str, ch: char) -> Self {
        Self {
            capture,
            ch,
            position: PestPunctuationPosition::Before,
        }
    }

    pub const fn after(capture: &'static str, ch: char) -> Self {
        Self {
            capture,
            ch,
            position: PestPunctuationPosition::After,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PestHighlight<C> {
    pub capture: Option<&'static str>,
    pub child_context: Option<C>,
    pub punctuation: &'static [PestPunctuation],
}

impl<C> PestHighlight<C> {
    pub const fn none() -> Self {
        Self {
            capture: None,
            child_context: None,
            punctuation: &[],
        }
    }

    pub const fn capture(capture: &'static str) -> Self {
        Self {
            capture: Some(capture),
            child_context: None,
            punctuation: &[],
        }
    }

    pub const fn child_context(child_context: C) -> Self {
        Self {
            capture: None,
            child_context: Some(child_context),
            punctuation: &[],
        }
    }

    pub const fn punctuation(punctuation: &'static [PestPunctuation]) -> Self {
        Self {
            capture: None,
            child_context: None,
            punctuation,
        }
    }

    pub const fn capture_with_punctuation(
        capture: &'static str,
        punctuation: &'static [PestPunctuation],
    ) -> Self {
        Self {
            capture: Some(capture),
            child_context: None,
            punctuation,
        }
    }

    pub const fn context_with_punctuation(
        child_context: C,
        punctuation: &'static [PestPunctuation],
    ) -> Self {
        Self {
            capture: None,
            child_context: Some(child_context),
            punctuation,
        }
    }
}

pub fn pest_highlight_tokens<R, C, F>(
    source: &str,
    pairs: Pairs<'_, R>,
    initial_context: C,
    highlight_for_rule: F,
) -> Vec<HighlightToken>
where
    R: RuleType,
    C: Copy,
    F: Fn(R, C) -> PestHighlight<C> + Copy,
{
    let mut tokens = Vec::new();

    for pair in pairs {
        collect_pest_highlight_tokens(
            source,
            pair,
            initial_context,
            &highlight_for_rule,
            &mut tokens,
        );
    }

    sort_and_dedupe(&mut tokens);
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

fn collect_pest_highlight_tokens<R, C, F>(
    source: &str,
    pair: Pair<'_, R>,
    context: C,
    highlight_for_rule: &F,
    tokens: &mut Vec<HighlightToken>,
) where
    R: RuleType,
    C: Copy,
    F: Fn(R, C) -> PestHighlight<C> + Copy,
{
    let highlight = highlight_for_rule(pair.as_rule(), context);
    if let Some(capture) = highlight.capture {
        tokens.push(token_from_pair(source, capture, &pair));
    }
    push_pest_punctuation(source, &pair, highlight.punctuation, tokens);

    let child_context = highlight.child_context.unwrap_or(context);
    for child in pair.into_inner() {
        collect_pest_highlight_tokens(source, child, child_context, highlight_for_rule, tokens);
    }
}

fn push_pest_punctuation<R>(
    source: &str,
    pair: &Pair<'_, R>,
    punctuation: &[PestPunctuation],
    tokens: &mut Vec<HighlightToken>,
) where
    R: RuleType,
{
    let span = pair.as_span();
    for punctuation in punctuation {
        match punctuation.position {
            PestPunctuationPosition::First => push_char_between(
                source,
                punctuation.capture,
                punctuation.ch,
                span.start(),
                span.end(),
                tokens,
            ),
            PestPunctuationPosition::Last => push_char_between_rev(
                source,
                punctuation.capture,
                punctuation.ch,
                span.start(),
                span.end(),
                tokens,
            ),
            PestPunctuationPosition::Before => push_char_before(
                source,
                punctuation.capture,
                punctuation.ch,
                span.start(),
                0,
                tokens,
            ),
            PestPunctuationPosition::After => push_char_after(
                source,
                punctuation.capture,
                punctuation.ch,
                span.end(),
                source.len(),
                tokens,
            ),
        }
    }
}

pub fn push_char_between(
    source: &str,
    capture: &str,
    needle: char,
    start: usize,
    end: usize,
    tokens: &mut Vec<HighlightToken>,
) {
    let start = start.min(source.len());
    let end = end.min(source.len());
    if start > end || !source.is_char_boundary(start) || !source.is_char_boundary(end) {
        return;
    }

    for (offset, ch) in source[start..end].char_indices() {
        if ch == needle {
            let token_start = start + offset;
            push_range(
                source,
                capture,
                token_start,
                token_start + ch.len_utf8(),
                tokens,
            );
            return;
        }
    }
}

pub fn push_char_between_rev(
    source: &str,
    capture: &str,
    needle: char,
    start: usize,
    end: usize,
    tokens: &mut Vec<HighlightToken>,
) {
    let start = start.min(source.len());
    let end = end.min(source.len());
    if start > end || !source.is_char_boundary(start) || !source.is_char_boundary(end) {
        return;
    }

    for (offset, ch) in source[start..end].char_indices().rev() {
        if ch == needle {
            let token_start = start + offset;
            push_range(
                source,
                capture,
                token_start,
                token_start + ch.len_utf8(),
                tokens,
            );
            return;
        }
    }
}

pub fn push_char_at_or_before(
    source: &str,
    capture: &str,
    needle: char,
    end: usize,
    floor: usize,
    tokens: &mut Vec<HighlightToken>,
) {
    if end <= source.len() && source.is_char_boundary(end) && source[end..].starts_with(needle) {
        push_range(source, capture, end, end + needle.len_utf8(), tokens);
        return;
    }
    push_char_before(source, capture, needle, end, floor, tokens);
}

pub fn push_char_before(
    source: &str,
    capture: &str,
    needle: char,
    end: usize,
    floor: usize,
    tokens: &mut Vec<HighlightToken>,
) {
    let end = end.min(source.len());
    let floor = floor.min(end);
    if !source.is_char_boundary(floor) || !source.is_char_boundary(end) {
        return;
    }

    for (relative_index, ch) in source[floor..end].char_indices().rev() {
        if ch == needle {
            let start = floor + relative_index;
            push_range(source, capture, start, start + ch.len_utf8(), tokens);
            return;
        }
        if !ch.is_whitespace() {
            return;
        }
    }
}

pub fn push_char_at_or_after(
    source: &str,
    capture: &str,
    needle: char,
    start: usize,
    ceiling: usize,
    tokens: &mut Vec<HighlightToken>,
) {
    push_char_after(source, capture, needle, start, ceiling, tokens);
}

pub fn push_char_after(
    source: &str,
    capture: &str,
    needle: char,
    start: usize,
    ceiling: usize,
    tokens: &mut Vec<HighlightToken>,
) {
    let start = start.min(source.len());
    let ceiling = ceiling.min(source.len());
    if start > ceiling || !source.is_char_boundary(start) || !source.is_char_boundary(ceiling) {
        return;
    }

    for (offset, ch) in source[start..ceiling].char_indices() {
        if ch == needle {
            let token_start = start + offset;
            push_range(
                source,
                capture,
                token_start,
                token_start + ch.len_utf8(),
                tokens,
            );
            return;
        }
        if !ch.is_whitespace() {
            return;
        }
    }
}

pub fn push_range(
    source: &str,
    capture: &str,
    start: usize,
    end: usize,
    tokens: &mut Vec<HighlightToken>,
) {
    if start < end
        && end <= source.len()
        && source.is_char_boundary(start)
        && source.is_char_boundary(end)
    {
        tokens.push(token_from_byte_range(source, capture, start, end));
    }
}

pub fn sort_and_dedupe(tokens: &mut Vec<HighlightToken>) {
    tokens.sort_by(|left, right| {
        (left.start, left.end, left.capture.as_str()).cmp(&(
            right.start,
            right.end,
            right.capture.as_str(),
        ))
    });
    tokens.dedup_by(|left, right| {
        left.start == right.start && left.end == right.end && left.capture == right.capture
    });
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

    #[test]
    fn token_sink_collects_ranges_and_bounded_punctuation() {
        let mut tokens = TokenSink::new("[greet _name] { done = true }");

        tokens.push_range("handler", 1, 6);
        tokens.push_char_before("punctuation.bracket", '[', 1, 0);
        tokens.push_char_after("punctuation.bracket", ']', 12, 13);
        tokens.push_char_at_or_after("punctuation.bracket", '{', 14, 16);
        tokens.push_range("handler", 1, 6);

        let captures: Vec<_> = tokens
            .into_tokens()
            .into_iter()
            .map(|token| (token.capture, token.text))
            .collect();

        assert_eq!(
            captures,
            vec![
                ("punctuation.bracket".to_string(), "[".to_string()),
                ("handler".to_string(), "greet".to_string()),
                ("punctuation.bracket".to_string(), "]".to_string()),
                ("punctuation.bracket".to_string(), "{".to_string()),
            ]
        );
    }
}
