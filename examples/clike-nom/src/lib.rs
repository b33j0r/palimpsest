use nom::{
    IResult, Parser,
    branch::alt,
    bytes::complete::{tag, take_while, take_while1},
    character::complete::{char, multispace1, none_of},
    combinator::{map, opt, recognize},
    multi::many0,
    sequence::{delimited, pair},
};
use palimpsest::{HighlightToken, parse_error_json, parse_success_json, token_from_byte_range};
use wasm_bindgen::prelude::wasm_bindgen;

type ParseResult<'a, T> = IResult<&'a str, T>;

#[derive(Debug, Clone, PartialEq, Eq)]
struct Capture {
    kind: &'static str,
    start: usize,
    end: usize,
}

#[wasm_bindgen]
pub fn parse_to_json(source: &str) -> String {
    match parse_tokens(source) {
        Ok(tokens) => parse_success_json(&tokens),
        Err(error) => parse_error_json(error),
    }
}

pub fn parse_tokens(source: &str) -> Result<Vec<HighlightToken>, String> {
    let (remaining, captures) =
        program(source, source).map_err(|error| format!("parse failed: {error}"))?;
    if !remaining.is_empty() {
        let offset = source.len() - remaining.len();
        return Err(format!("unexpected input at byte {offset}"));
    }

    Ok(captures
        .into_iter()
        .map(|capture| token_from_byte_range(source, capture.kind, capture.start, capture.end))
        .collect())
}

fn program<'a>(source: &'a str, input: &'a str) -> ParseResult<'a, Vec<Capture>> {
    let (mut input, mut captures) = trivia0(source, input)?;
    while !input.is_empty() {
        let (next, mut function_captures) = function(source, input)?;
        captures.append(&mut function_captures);
        let (next, mut trivia_captures) = trivia0(source, next)?;
        captures.append(&mut trivia_captures);
        input = next;
    }
    Ok((input, captures))
}

fn function<'a>(source: &'a str, input: &'a str) -> ParseResult<'a, Vec<Capture>> {
    let mut captures = Vec::new();
    let (input, keyword) = keyword(source, input, "fn")?;
    captures.push(keyword);

    let (input, mut trivia) = trivia1(source, input)?;
    captures.append(&mut trivia);

    let (input, name) = captured_identifier(source, input, "function")?;
    captures.push(name);
    let (input, mut params) = delimited_symbol(source, input, '(', |source, input| {
        let (input, params) = opt(|input| parameters(source, input)).parse(input)?;
        Ok((input, params.unwrap_or_default()))
    })?;
    captures.append(&mut params);

    let (input, mut trivia) = trivia0(source, input)?;
    captures.append(&mut trivia);
    let (input, mut return_type) = opt(|input| return_type(source, input)).parse(input)?;
    if let Some(return_type) = return_type.as_mut() {
        captures.append(return_type);
    }

    let (input, mut body) = block(source, input)?;
    captures.append(&mut body);
    Ok((input, captures))
}

fn parameters<'a>(source: &'a str, input: &'a str) -> ParseResult<'a, Vec<Capture>> {
    separated(source, input, ',', |source, input| parameter(source, input))
}

fn parameter<'a>(source: &'a str, input: &'a str) -> ParseResult<'a, Vec<Capture>> {
    let mut captures = Vec::new();
    let (input, variable) = captured_identifier(source, input, "variable")?;
    captures.push(variable);
    let (input, colon) = symbol(source, input, ':')?;
    captures.push(colon);
    let (input, ty) = ty(source, input)?;
    captures.push(ty);
    Ok((input, captures))
}

fn return_type<'a>(source: &'a str, input: &'a str) -> ParseResult<'a, Vec<Capture>> {
    let mut captures = Vec::new();
    let (input, arrow) = operator(source, input, "->")?;
    captures.push(arrow);
    let (input, ty) = ty(source, input)?;
    captures.push(ty);
    Ok((input, captures))
}

fn block<'a>(source: &'a str, input: &'a str) -> ParseResult<'a, Vec<Capture>> {
    delimited_symbol(source, input, '{', |source, mut input| {
        let mut captures = Vec::new();
        loop {
            let (next, mut trivia) = trivia0(source, input)?;
            captures.append(&mut trivia);
            input = next;
            if input.starts_with('}') {
                return Ok((input, captures));
            }

            let (next, mut statement) = statement(source, input)?;
            captures.append(&mut statement);
            input = next;
        }
    })
}

fn statement<'a>(source: &'a str, input: &'a str) -> ParseResult<'a, Vec<Capture>> {
    alt((
        |input| let_statement(source, input),
        |input| if_statement(source, input),
        |input| while_statement(source, input),
        |input| return_statement(source, input),
        |input| expression_statement(source, input),
    ))
    .parse(input)
}

fn let_statement<'a>(source: &'a str, input: &'a str) -> ParseResult<'a, Vec<Capture>> {
    let mut captures = Vec::new();
    let (input, keyword) = keyword(source, input, "let")?;
    captures.push(keyword);
    let (input, variable) = captured_identifier(source, input, "variable")?;
    captures.push(variable);
    let (input, colon) = symbol(source, input, ':')?;
    captures.push(colon);
    let (input, ty) = ty(source, input)?;
    captures.push(ty);
    let (input, equals) = operator(source, input, "=")?;
    captures.push(equals);
    let (input, mut expression) = expression(source, input)?;
    captures.append(&mut expression);
    let (input, semicolon) = symbol(source, input, ';')?;
    captures.push(semicolon);
    Ok((input, captures))
}

fn if_statement<'a>(source: &'a str, input: &'a str) -> ParseResult<'a, Vec<Capture>> {
    let mut captures = Vec::new();
    let (input, keyword) = keyword(source, input, "if")?;
    captures.push(keyword);
    let (input, mut condition) = delimited_symbol(source, input, '(', |source, input| {
        expression(source, input)
    })?;
    captures.append(&mut condition);
    let (input, mut then_block) = block(source, input)?;
    captures.append(&mut then_block);
    let (input, mut else_block) = opt(|input| else_clause(source, input)).parse(input)?;
    if let Some(else_block) = else_block.as_mut() {
        captures.append(else_block);
    }
    Ok((input, captures))
}

fn else_clause<'a>(source: &'a str, input: &'a str) -> ParseResult<'a, Vec<Capture>> {
    let mut captures = Vec::new();
    let (input, keyword) = keyword(source, input, "else")?;
    captures.push(keyword);
    let (input, mut body) = block(source, input)?;
    captures.append(&mut body);
    Ok((input, captures))
}

fn while_statement<'a>(source: &'a str, input: &'a str) -> ParseResult<'a, Vec<Capture>> {
    let mut captures = Vec::new();
    let (input, keyword) = keyword(source, input, "while")?;
    captures.push(keyword);
    let (input, mut condition) = delimited_symbol(source, input, '(', |source, input| {
        expression(source, input)
    })?;
    captures.append(&mut condition);
    let (input, mut body) = block(source, input)?;
    captures.append(&mut body);
    Ok((input, captures))
}

fn return_statement<'a>(source: &'a str, input: &'a str) -> ParseResult<'a, Vec<Capture>> {
    let mut captures = Vec::new();
    let (input, keyword) = keyword(source, input, "return")?;
    captures.push(keyword);
    let (input, mut expression) = expression(source, input)?;
    captures.append(&mut expression);
    let (input, semicolon) = symbol(source, input, ';')?;
    captures.push(semicolon);
    Ok((input, captures))
}

fn expression_statement<'a>(source: &'a str, input: &'a str) -> ParseResult<'a, Vec<Capture>> {
    let (input, mut captures) = expression(source, input)?;
    let (input, semicolon) = symbol(source, input, ';')?;
    captures.push(semicolon);
    Ok((input, captures))
}

fn expression<'a>(source: &'a str, input: &'a str) -> ParseResult<'a, Vec<Capture>> {
    let mut captures = Vec::new();
    let (mut input, mut left) = atom(source, input)?;
    captures.append(&mut left);

    loop {
        let (next, mut trivia) = trivia0(source, input)?;
        let Ok((after_operator, operator)) = binary_operator(source, next) else {
            captures.append(&mut trivia);
            return Ok((next, captures));
        };
        captures.append(&mut trivia);
        captures.push(operator);

        let (after_atom, mut right) = atom(source, after_operator)?;
        captures.append(&mut right);
        input = after_atom;
    }
}

fn atom<'a>(source: &'a str, input: &'a str) -> ParseResult<'a, Vec<Capture>> {
    alt((
        |input| call(source, input),
        |input| literal(source, input),
        |input| variable(source, input),
        |input| {
            delimited_symbol(source, input, '(', |source, input| {
                expression(source, input)
            })
        },
    ))
    .parse(input)
}

fn call<'a>(source: &'a str, input: &'a str) -> ParseResult<'a, Vec<Capture>> {
    let mut captures = Vec::new();
    let (input, name) = captured_identifier(source, input, "function")?;
    let (input, args) = delimited_symbol(source, input, '(', |source, input| {
        let (input, args) = opt(|input| arguments(source, input)).parse(input)?;
        Ok((input, args.unwrap_or_default()))
    })?;
    captures.push(name);
    captures.extend(args);
    Ok((input, captures))
}

fn arguments<'a>(source: &'a str, input: &'a str) -> ParseResult<'a, Vec<Capture>> {
    separated(source, input, ',', |source, input| {
        expression(source, input)
    })
}

fn literal<'a>(source: &'a str, input: &'a str) -> ParseResult<'a, Vec<Capture>> {
    alt((
        |input| boolean(source, input),
        |input| string(source, input),
        |input| number(source, input),
    ))
    .parse(input)
}

fn variable<'a>(source: &'a str, input: &'a str) -> ParseResult<'a, Vec<Capture>> {
    let (input, variable) = captured_identifier(source, input, "variable")?;
    Ok((input, vec![variable]))
}

fn separated<'a, F>(
    source: &'a str,
    input: &'a str,
    separator: char,
    mut parser: F,
) -> ParseResult<'a, Vec<Capture>>
where
    F: FnMut(&'a str, &'a str) -> ParseResult<'a, Vec<Capture>>,
{
    let mut captures = Vec::new();
    let (mut input, mut first) = parser(source, input)?;
    captures.append(&mut first);

    loop {
        let (next, mut trivia) = trivia0(source, input)?;
        let Ok((after_separator, separator)) = raw_symbol(source, next, separator) else {
            captures.append(&mut trivia);
            return Ok((next, captures));
        };
        captures.append(&mut trivia);
        captures.push(separator);
        let (after_item, mut item) = parser(source, after_separator)?;
        captures.append(&mut item);
        input = after_item;
    }
}

fn delimited_symbol<'a, F>(
    source: &'a str,
    input: &'a str,
    open: char,
    parser: F,
) -> ParseResult<'a, Vec<Capture>>
where
    F: FnOnce(&'a str, &'a str) -> ParseResult<'a, Vec<Capture>>,
{
    let close = match open {
        '(' => ')',
        '{' => '}',
        _ => open,
    };

    let mut captures = Vec::new();
    let (input, open) = symbol(source, input, open)?;
    captures.push(open);
    let (input, mut content) = parser(source, input)?;
    captures.append(&mut content);
    let (input, close) = symbol(source, input, close)?;
    captures.push(close);
    Ok((input, captures))
}

fn symbol<'a>(source: &'a str, input: &'a str, ch: char) -> ParseResult<'a, Capture> {
    let (input, _) = trivia0(source, input)?;
    raw_symbol(source, input, ch)
}

fn raw_symbol<'a>(source: &'a str, input: &'a str, ch: char) -> ParseResult<'a, Capture> {
    let start = source.len() - input.len();
    let (input, _) = char(ch).parse(input)?;
    Ok((
        input,
        capture("punctuation", start, source.len() - input.len()),
    ))
}

fn keyword<'a>(
    source: &'a str,
    input: &'a str,
    expected: &'static str,
) -> ParseResult<'a, Capture> {
    let (input, _) = trivia0(source, input)?;
    let start = source.len() - input.len();
    let (input, word) = identifier.parse(input)?;
    if word == expected {
        Ok((input, capture("keyword", start, source.len() - input.len())))
    } else {
        Err(nom::Err::Error(nom::error::Error::new(
            input,
            nom::error::ErrorKind::Tag,
        )))
    }
}

fn ty<'a>(source: &'a str, input: &'a str) -> ParseResult<'a, Capture> {
    let (input, _) = trivia0(source, input)?;
    let start = source.len() - input.len();
    let (input, _) = identifier.parse(input)?;
    Ok((input, capture("type", start, source.len() - input.len())))
}

fn boolean<'a>(source: &'a str, input: &'a str) -> ParseResult<'a, Vec<Capture>> {
    let (input, _) = trivia0(source, input)?;
    let start = source.len() - input.len();
    let (input, value) = identifier.parse(input)?;
    if value == "true" || value == "false" {
        Ok((
            input,
            vec![capture("keyword", start, source.len() - input.len())],
        ))
    } else {
        Err(nom::Err::Error(nom::error::Error::new(
            input,
            nom::error::ErrorKind::Tag,
        )))
    }
}

fn string<'a>(source: &'a str, input: &'a str) -> ParseResult<'a, Vec<Capture>> {
    let (input, _) = trivia0(source, input)?;
    let start = source.len() - input.len();
    let (input, _) = string_literal.parse(input)?;
    Ok((
        input,
        vec![capture("string", start, source.len() - input.len())],
    ))
}

fn number<'a>(source: &'a str, input: &'a str) -> ParseResult<'a, Vec<Capture>> {
    let (input, _) = trivia0(source, input)?;
    let start = source.len() - input.len();
    let (input, _) = number_literal.parse(input)?;
    Ok((
        input,
        vec![capture("number", start, source.len() - input.len())],
    ))
}

fn captured_identifier<'a>(
    source: &'a str,
    input: &'a str,
    kind: &'static str,
) -> ParseResult<'a, Capture> {
    let (input, _) = trivia0(source, input)?;
    let start = source.len() - input.len();
    let (input, _) = identifier.parse(input)?;
    Ok((input, capture(kind, start, source.len() - input.len())))
}

fn binary_operator<'a>(source: &'a str, input: &'a str) -> ParseResult<'a, Capture> {
    alt((
        |input| operator(source, input, "=="),
        |input| operator(source, input, "!="),
        |input| operator(source, input, ">="),
        |input| operator(source, input, "<="),
        |input| operator(source, input, "&&"),
        |input| operator(source, input, "||"),
        |input| operator(source, input, "+"),
        |input| operator(source, input, "-"),
        |input| operator(source, input, "*"),
        |input| operator(source, input, "/"),
        |input| operator(source, input, ">"),
        |input| operator(source, input, "<"),
    ))
    .parse(input)
}

fn operator<'a>(
    source: &'a str,
    input: &'a str,
    expected: &'static str,
) -> ParseResult<'a, Capture> {
    let (input, _) = trivia0(source, input)?;
    let start = source.len() - input.len();
    let (input, _) = tag(expected).parse(input)?;
    Ok((
        input,
        capture("operator", start, source.len() - input.len()),
    ))
}

fn trivia0<'a>(source: &'a str, input: &'a str) -> ParseResult<'a, Vec<Capture>> {
    let mut captures = Vec::new();
    let mut input = input;

    loop {
        if let Ok((next, _)) = multispace1::<_, nom::error::Error<_>>(input) {
            input = next;
            continue;
        }

        let start = source.len() - input.len();
        if let Ok((next, comment)) = line_comment(input) {
            captures.push(capture("comment", start, start + comment.len()));
            input = next;
            continue;
        }

        return Ok((input, captures));
    }
}

fn trivia1<'a>(source: &'a str, input: &'a str) -> ParseResult<'a, Vec<Capture>> {
    let before = input;
    let (input, captures) = trivia0(source, input)?;
    if input.len() == before.len() {
        return Err(nom::Err::Error(nom::error::Error::new(
            input,
            nom::error::ErrorKind::Space,
        )));
    }
    Ok((input, captures))
}

fn line_comment(input: &str) -> ParseResult<'_, &str> {
    recognize(pair(tag("//"), take_while(|ch| ch != '\n' && ch != '\r'))).parse(input)
}

fn string_literal(input: &str) -> ParseResult<'_, &str> {
    recognize(delimited(
        char('"'),
        many0(alt((
            map(tag("\\\""), |_| ()),
            map(tag("\\\\"), |_| ()),
            map(none_of("\""), |_| ()),
        ))),
        char('"'),
    ))
    .parse(input)
}

fn number_literal(input: &str) -> ParseResult<'_, &str> {
    recognize(pair(
        take_while1(|ch: char| ch.is_ascii_digit()),
        opt(pair(char('.'), take_while1(|ch: char| ch.is_ascii_digit()))),
    ))
    .parse(input)
}

fn identifier(input: &str) -> ParseResult<'_, &str> {
    recognize(pair(
        take_while1(is_ident_start),
        take_while(is_ident_continue),
    ))
    .parse(input)
}

fn capture(kind: &'static str, start: usize, end: usize) -> Capture {
    Capture { kind, start, end }
}

fn is_ident_start(ch: char) -> bool {
    ch.is_ascii_alphabetic() || ch == '_'
}

fn is_ident_continue(ch: char) -> bool {
    ch.is_ascii_alphanumeric() || ch == '_'
}

#[cfg(test)]
mod tests {
    use super::*;

    const EXAMPLES: &[&str] = &[
        include_str!("../../observatory.clike"),
        include_str!("../../garden.clike"),
        include_str!("../../vault.clike"),
    ];

    #[test]
    fn parses_shared_examples() {
        for source in EXAMPLES {
            let tokens = parse_tokens(source).expect("example should parse");
            assert!(tokens.iter().any(|token| token.capture == "function"));
            assert!(tokens.iter().any(|token| token.capture == "keyword"));
        }
    }

    #[test]
    fn rejects_unstructured_token_streams() {
        let error = parse_tokens("fn missing_body() -> int").unwrap_err();
        assert!(error.contains("parse failed") || error.contains("unexpected input"));
    }
}
