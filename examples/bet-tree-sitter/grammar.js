module.exports = grammar({
  name: "bet",

  extras: $ => [
    /\s/,
    $.comment,
  ],

  word: $ => $.identifier,

  rules: {
    source_file: $ => repeat($._statement),

    _statement: $ => choice(
      $.inputs_declaration,
      $.variables_declaration,
      $.method_declaration,
      $.assignment_statement,
      $.if_statement,
      $.for_statement,
      $.while_statement,
      $.buy_statement,
      $.sell_statement,
      $.plot_statement,
      $.return_statement,
      $.expression_statement,
    ),

    inputs_declaration: $ => seq(
      keyword("Inputs"),
      ":",
      optional(commaSep1($.parameter)),
      ";",
    ),

    variables_declaration: $ => seq(
      choice(keyword("Vars"), keyword("Variables")),
      ":",
      optional(commaSep1($.parameter)),
      ";",
    ),

    parameter: $ => seq(
      field("name", $.identifier),
      optional(seq("(", field("default", $._expression), ")")),
    ),

    method_declaration: $ => seq(
      keyword("Method"),
      field("name", $.function_name),
      "(",
      optional(commaSep1($.parameter)),
      ")",
      keyword("Begin"),
      repeat($._statement),
      keyword("End"),
      optional(";"),
    ),

    assignment_statement: $ => prec(1, seq(
      field("left", $.identifier),
      "=",
      field("right", $._expression),
      ";",
    )),

    if_statement: $ => prec.right(seq(
      keyword("If"),
      field("condition", $._expression),
      keyword("Then"),
      field("consequence", $._statement_or_block),
      optional(seq(keyword("Else"), field("alternative", $._statement_or_block))),
    )),

    for_statement: $ => seq(
      keyword("For"),
      field("name", $.identifier),
      "=",
      field("start", $._expression),
      keyword("To"),
      field("end", $._expression),
      keyword("Begin"),
      repeat($._statement),
      keyword("End"),
      optional(";"),
    ),

    while_statement: $ => seq(
      keyword("While"),
      field("condition", $._expression),
      keyword("Begin"),
      repeat($._statement),
      keyword("End"),
      optional(";"),
    ),

    _statement_or_block: $ => choice(
      $._statement,
      seq(keyword("Begin"), repeat($._statement), keyword("End")),
    ),

    buy_statement: $ => seq(
      choice(keyword("Buy"), keyword("SellShort")),
      optional($.order_label),
      optional($.position_size),
      optional($.bar_timing),
      optional($.order_action),
      ";",
    ),

    sell_statement: $ => seq(
      choice(keyword("Sell"), keyword("BuyToCover")),
      optional($.order_label),
      optional(keyword("From")),
      optional(keyword("Entry")),
      optional($.bar_timing),
      optional($.order_action),
      ";",
    ),

    order_label: $ => prec(1, seq("(", $.string, ")")),
    position_size: $ => seq($._expression, keyword("Contracts")),
    bar_timing: $ => seq(choice(keyword("Next"), keyword("This")), keyword("Bar")),
    order_action: $ => seq(choice(keyword("At"), keyword("On")), choice(keyword("Market"), $._expression)),

    plot_statement: $ => seq(
      keyword("Plot"),
      choice($.number, $.identifier),
      "(",
      $._expression,
      optional(seq(",", $.string)),
      ")",
      ";",
    ),

    return_statement: $ => seq(
      keyword("Return"),
      optional($._expression),
      ";",
    ),

    expression_statement: $ => seq($._expression, ";"),

    _expression: $ => choice(
      $.cross_expression,
      $.binary_expression,
      $.unary_expression,
      $.call_expression,
      $._primary_expression,
    ),

    cross_expression: $ => prec.left(1, seq(
      $._primary_expression,
      keyword("Crosses"),
      choice(keyword("Over"), keyword("Under")),
      $._primary_expression,
    )),

    binary_expression: $ => choice(
      ...[
        ["Or", 2],
        ["And", 3],
        ["=", 4],
        ["<>", 4],
        [">", 4],
        [">=", 4],
        ["<", 4],
        ["<=", 4],
        ["+", 5],
        ["-", 5],
        ["*", 6],
        ["/", 6],
      ].map(([operator, precedence]) => prec.left(precedence, seq(
        field("left", $._expression),
        field("operator", operator),
        field("right", $._expression),
      ))),
    ),

    unary_expression: $ => prec(7, seq(choice(keyword("Not"), "-", "+"), $._expression)),

    call_expression: $ => prec(8, seq(
      field("function", $.function_name),
      "(",
      optional(commaSep1($._expression)),
      ")",
    )),

    _primary_expression: $ => choice(
      $.identifier,
      $.number,
      $.string,
      $.true,
      $.false,
      seq("(", $._expression, ")"),
    ),

    true: $ => keyword("True"),
    false: $ => keyword("False"),

    identifier: _ => /[A-Za-z_][A-Za-z0-9_]*/,
    function_name: $ => $.identifier,
    number: _ => /\d+(\.\d+)?/,
    string: _ => seq('"', repeat(choice(/[^"\\\n]/, /\\./)), '"'),
    comment: _ => token(seq("//", /.*/)),
  },
});

function commaSep1(rule) {
  return seq(rule, repeat(seq(",", rule)));
}

function keyword(value) {
  return value;
}
