use palimpsest::{
    HighlightToken, PestHighlight, parse_error_json, parse_success_json, pest_highlight_tokens,
};
use pest::Parser;
use pest_derive::Parser;
use wasm_bindgen::prelude::wasm_bindgen;

#[derive(Parser)]
#[grammar = "talkie.pest"]
pub struct TalkieParser;

pub fn parse_tokens(source: &str) -> Result<Vec<HighlightToken>, String> {
    let pairs = TalkieParser::parse(Rule::program, source).map_err(|error| error.to_string())?;
    Ok(pest_highlight_tokens(source, pairs, (), highlight_for_rule))
}

#[wasm_bindgen]
pub fn parse_to_json(source: &str) -> String {
    match parse_tokens(source) {
        Ok(tokens) => parse_success_json(&tokens),
        Err(error) => parse_error_json(error),
    }
}

fn highlight_for_rule(rule: Rule, _: ()) -> PestHighlight<()> {
    match rule {
        Rule::class_name => PestHighlight::capture("class"),
        Rule::selector_part | Rule::unary_selector | Rule::unary_send => {
            PestHighlight::capture("selector")
        }
        Rule::variable => PestHighlight::capture("variable"),
        Rule::number => PestHighlight::capture("number"),
        Rule::string => PestHighlight::capture("string"),
        Rule::comment => PestHighlight::capture("comment"),
        Rule::assignment_operator | Rule::return_operator | Rule::binary_operator => {
            PestHighlight::capture("operator")
        }
        _ => PestHighlight::none(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const EXAMPLES: &[&str] = &[
        include_str!("../../observatory.talkie"),
        include_str!("../../garden.talkie"),
        include_str!("../../vault.talkie"),
    ];

    #[test]
    fn parses_talkie_examples() {
        for source in EXAMPLES {
            let tokens = parse_tokens(source).expect("example should parse");
            assert!(tokens.iter().any(|token| token.capture == "class"));
            assert!(tokens.iter().any(|token| token.capture == "selector"));
        }
    }
}
