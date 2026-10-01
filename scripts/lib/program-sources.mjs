// The statement programs the compile transcript asks the reference about.
//
// The expression rows of the compile transcript are authored in
// `scripts/lib/reference-compile.exs`, inside the reference's run. These are
// authored here instead, on this side, for one reason: the suite has to hold
// the transcript's program rows equal to the list that produced them, and a
// list the suite can import is a list it can compare against. A list kept only
// inside the Elixir file would be one the suite could restate but not read.
// `scripts/reference-compile.mjs` hands this list to the Elixir side as a JSON
// file, and `test/reference-compile.test.ts` reads it to check the rows.
//
// WHAT THE LIST COVERS. Every statement form the reference's program grammar
// accepts at the pinned tag, and every refusal that grammar adds to the
// expression grammar's, each at least once:
//
//   - assignment to an identifier, a property access and a bracket access,
//     and to chains of them, since the location is emitted segment by segment;
//   - a bare expression statement;
//   - the separator between statements, with and without a trailing one, and
//     inside a block;
//   - if, if/else, an else-if chain with and without a final else, and an
//     empty block in each position a block can take;
//   - while, a nested while, and control flow nested inside a loop;
//   - a statement ending in a closing brace followed by another statement with
//     no separator between them;
//   - the refusals: an else with no if before it (leading a program, after a
//     statement and after a closing brace), a token after a finished
//     statement, a left side that is not a location, a missing block, an
//     unterminated block, a statement keyword in expression position, an
//     equals sign inside an expression, an empty statement, and a control-flow
//     keyword with no condition;
//   - three programs in the shape a statechart's script element holds: a root
//     set to a literal, a root incremented once, and a root incremented twice
//     and then doubled, plus the first and last again with the surrounding
//     newlines and indentation a script body carries in a document.
//
// WHAT AN ENTRY SAYS. `id` names the row and is unique. `source` is the program
// text. `answer` is what the entry is authored to draw from the reference:
// `program` for a source it compiles and `refusal` for one it refuses. The
// Elixir side refuses to write anything when the reference answers otherwise,
// so an entry whose `answer` is wrong stops the run rather than landing as a
// row under the wrong kind.
//
// A refusal entry carries no reason label. The expression rows label each
// refusal with a member of this package's closed reason union, and the
// statement grammar's refusals have no members there yet; naming them is the
// statement compiler's decision, made against these rows, not ahead of them.
// The id's middle segment names the message family for a reader.
//
// Every example stays inside the library world: loans, patrons, holds, fines.

/**
 * @typedef {{ readonly id: string, readonly source: string, readonly answer: "program" | "refusal" }} ProgramSource
 */

/** @type {readonly ProgramSource[]} */
export const PROGRAM_SOURCES = Object.freeze([
  // Assignment, one row per location shape. A location is emitted as one
  // literal per segment, so the chains are what pin the segment count.
  { id: "program/assign/identifier", source: "renewals = 0", answer: "program" },
  {
    id: "program/assign/property",
    source: "loan.renewals = loan.renewals + 1",
    answer: "program",
  },
  { id: "program/assign/bracket-string", source: "loan['status'] = 'returned'", answer: "program" },
  { id: "program/assign/bracket-index", source: "holds[0] = patron.id", answer: "program" },
  {
    id: "program/assign/property-chain",
    source: "patron.card.status = 'active'",
    answer: "program",
  },
  {
    id: "program/assign/mixed-chain",
    source: "patron.holds[0].status = 'ready'",
    answer: "program",
  },
  {
    id: "program/assign/parenthesized-location",
    source: "(loan).renewals = 0",
    answer: "program",
  },

  // A bare expression statement, alone and after an assignment.
  { id: "program/expression/arithmetic", source: "loan.renewals + 1", answer: "program" },
  { id: "program/expression/comparison", source: "loan.renewals < 3", answer: "program" },
  { id: "program/expression/call", source: "len(patron.holds)", answer: "program" },

  // The separator.
  { id: "program/sequence/two-statements", source: "renewals = 0; fines = 0", answer: "program" },
  {
    id: "program/sequence/trailing-separator",
    source: "renewals = 0; fines = 0;",
    answer: "program",
  },
  {
    id: "program/sequence/assignment-then-expression",
    source: "renewals = 1; renewals + 1",
    answer: "program",
  },
  {
    id: "program/sequence/multi-line",
    source: "renewals = 0;\nfines = 0;\nstatus = 'clear'",
    answer: "program",
  },

  // if, in every shape the grammar takes.
  {
    id: "program/if/then",
    source: "if loan.renewals < 3 { loan.renewals = loan.renewals + 1 }",
    answer: "program",
  },
  {
    id: "program/if/else",
    source: "if loan.overdue { loan.status = 'late' } else { loan.status = 'on-time' }",
    answer: "program",
  },
  {
    id: "program/if/else-if-chain",
    source:
      "if fines > 10 { status = 'blocked' } else if fines > 0 { status = 'warned' } else { status = 'clear' }",
    answer: "program",
  },
  {
    id: "program/if/else-if-without-else",
    source: "if fines > 10 { status = 'blocked' } else if fines > 0 { status = 'warned' }",
    answer: "program",
  },
  { id: "program/if/empty-then", source: "if loan.overdue { }", answer: "program" },
  {
    id: "program/if/empty-else",
    source: "if loan.overdue { fines = fines + 1 } else { }",
    answer: "program",
  },
  {
    id: "program/if/block-with-separators",
    source: "if loan.overdue { fines = fines + 1; status = 'late'; }",
    answer: "program",
  },
  {
    id: "program/if/expression-in-block",
    source: "if loan.overdue { fines + 1 }",
    answer: "program",
  },

  // while, alone, nested, and with control flow inside it.
  {
    id: "program/while/loop",
    source: "while renewals < 3 { renewals = renewals + 1 }",
    answer: "program",
  },
  {
    id: "program/while/nested",
    source: "while shelves > 0 { while holds > 0 { holds = holds - 1 } shelves = shelves - 1 }",
    answer: "program",
  },
  { id: "program/while/empty-body", source: "while loan.overdue { }", answer: "program" },
  {
    id: "program/while/if-inside",
    source:
      "while holds > 0 { if patron.ready { holds = holds - 1 } else { patron.ready = true } }",
    answer: "program",
  },

  // A statement that ends in a closing brace may be followed by another with
  // no separator; with one is the same program.
  {
    id: "program/brace-terminated/if-then-statement",
    source: "if loan.overdue { fines = 1 } status = 'late'",
    answer: "program",
  },
  {
    id: "program/brace-terminated/while-then-statement",
    source: "while renewals < 3 { renewals = renewals + 1 } status = 'renewed'",
    answer: "program",
  },
  {
    id: "program/brace-terminated/if-then-if",
    source: "if loan.overdue { fines = 1 } if patron.blocked { status = 'held' }",
    answer: "program",
  },
  {
    id: "program/brace-terminated/with-separator",
    source: "if loan.overdue { fines = 1 }; status = 'late'",
    answer: "program",
  },

  // The script-element shapes: a root set to a literal, incremented once, and
  // incremented twice then doubled; then the first and last with the newlines
  // and indentation a script body carries inside a document.
  { id: "program/script/root-set-to-literal", source: "renewals = 0;", answer: "program" },
  {
    id: "program/script/root-incremented-once",
    source: "renewals = renewals + 1;",
    answer: "program",
  },
  {
    id: "program/script/root-incremented-twice-and-doubled",
    source: "renewals = renewals + 1; renewals = renewals + 1; renewals = renewals * 2;",
    answer: "program",
  },
  {
    id: "program/script/indented-root-set-to-literal",
    source: "\n        renewals = 0;\n      ",
    answer: "program",
  },
  {
    id: "program/script/indented-root-incremented-twice-and-doubled",
    source:
      "\n        renewals = renewals + 1;\n        renewals = renewals + 1;\n        renewals = renewals * 2;\n      ",
    answer: "program",
  },

  // An else with no if before it: leading the program, after a statement that
  // does not end in a brace, and after one that does.
  {
    id: "program-refusal/stray-else/leading",
    source: "else { status = 'late' }",
    answer: "refusal",
  },
  {
    id: "program-refusal/stray-else/after-statement",
    source: "status = 'late' else { status = 'on-time' }",
    answer: "refusal",
  },
  {
    id: "program-refusal/stray-else/after-while",
    source: "while loan.overdue { } else { status = 'late' }",
    answer: "refusal",
  },

  // A token after a finished statement that is neither a separator nor the end.
  {
    id: "program-refusal/after-statement/missing-separator",
    source: "renewals = 1 fines = 0",
    answer: "refusal",
  },
  {
    id: "program-refusal/after-statement/closing-brace",
    source: "renewals = 1 }",
    answer: "refusal",
  },

  // A left side that is not a location.
  { id: "program-refusal/not-a-location/literal", source: "3 = renewals", answer: "refusal" },
  { id: "program-refusal/not-a-location/call", source: "len(holds) = 0", answer: "refusal" },
  {
    id: "program-refusal/not-a-location/arithmetic",
    source: "renewals + 1 = 2",
    answer: "refusal",
  },

  // A block that never opens. The last writes a block where the condition
  // belongs, which reads as an empty object, so the block is still missing.
  {
    id: "program-refusal/missing-block/if-token",
    source: "if loan.overdue status = 'late'",
    answer: "refusal",
  },
  {
    id: "program-refusal/missing-block/if-end-of-input",
    source: "if loan.overdue",
    answer: "refusal",
  },
  {
    id: "program-refusal/missing-block/while-token",
    source: "while loan.overdue status = 'late'",
    answer: "refusal",
  },
  {
    id: "program-refusal/missing-block/else-token",
    source: "if loan.overdue { } else status = 'late'",
    answer: "refusal",
  },
  {
    id: "program-refusal/missing-block/object-literal-condition",
    source: "if { }",
    answer: "refusal",
  },

  // A block that never closes. The last opens one and ends: the block expects
  // a statement first, so the refusal is the expression grammar's, at the end.
  {
    id: "program-refusal/unterminated-block/end-of-input",
    source: "if loan.overdue { fines = 1",
    answer: "refusal",
  },
  {
    id: "program-refusal/unterminated-block/token",
    source: "if loan.overdue { fines = 1 )",
    answer: "refusal",
  },
  {
    id: "program-refusal/unterminated-block/nothing-after-the-brace",
    source: "while loan.overdue {",
    answer: "refusal",
  },

  // A statement keyword where an expression belongs.
  { id: "program-refusal/keyword-in-expression/if", source: "status = if", answer: "refusal" },
  { id: "program-refusal/keyword-in-expression/else", source: "status = else", answer: "refusal" },
  {
    id: "program-refusal/keyword-in-expression/while",
    source: "status = while",
    answer: "refusal",
  },
  {
    id: "program-refusal/keyword-in-expression/condition",
    source: "if while { }",
    answer: "refusal",
  },

  // An equals sign inside an expression: a chained assignment, and one in a
  // condition.
  {
    id: "program-refusal/equals-in-expression/chained-assignment",
    source: "renewals = fines = 0",
    answer: "refusal",
  },
  {
    id: "program-refusal/equals-in-expression/condition",
    source: "if renewals = 3 { }",
    answer: "refusal",
  },

  // An empty statement: a doubled separator, at the top and inside a block, a
  // lone one, a leading one, and no statement at all.
  {
    id: "program-refusal/empty-statement/doubled-separator",
    source: "renewals = 1;;",
    answer: "refusal",
  },
  {
    id: "program-refusal/empty-statement/doubled-separator-in-block",
    source: "if loan.overdue { fines = 1;; }",
    answer: "refusal",
  },
  { id: "program-refusal/empty-statement/lone-separator", source: ";", answer: "refusal" },
  {
    id: "program-refusal/empty-statement/leading-separator",
    source: "; renewals = 1",
    answer: "refusal",
  },
  { id: "program-refusal/empty-statement/empty-source", source: "", answer: "refusal" },

  // A control-flow keyword with nothing after it.
  { id: "program-refusal/missing-condition/while", source: "while", answer: "refusal" },
  { id: "program-refusal/missing-condition/if", source: "if", answer: "refusal" },
]);
