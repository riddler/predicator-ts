# The reference half of the compile transcript: run inside an export of the
# reference implementation, never inside this repository.
#
#   mix run <this file> <output directory>
#
# `scripts/reference-compile.mjs` is what runs this, with the export as the
# working directory, and it is the only intended caller: it checks the export
# against the tag it was asked for and writes what this leaves behind into
# `conformance/transcript/`. Run by hand, this writes two files into the output
# directory and nothing else.
#
# WHAT THIS DOES. For each authored source it calls `Predicator.compile/1` and
# records the answer, and for each authored source and option combination it
# calls `Predicator.parse/2` and `Predicator.decompile/2` and records the
# rendering. Nothing here computes an answer; the reference does. The
# reference's own canonical writer, `Predicator.Conformance.JSON.encode_lines/1`,
# writes each row as one line, and `Predicator.Conformance.Values.to_json/1`
# encodes an instruction list's operands in the same tagged encoding the
# vendored corpus carries, so a date operand reads as a tagged object here
# exactly as it does there.
#
# WHY NOT THE CORPUS GENERATOR. `scripts/lib/reference-transcript.exs` hands
# its authored cases to `Predicator.Conformance.Generator.generate/1`, which
# answers an error when a source does not compile; a refusal therefore has no
# oracle through it, and a rendering has no field there to be written into.
# This file calls the two entry points directly instead, which is the whole of
# what it calls.
#
# THREE KINDS OF ROW, each authored here. A `compile` row holds a source the
# reference compiles and the instruction list it answered. A `refusal` row
# holds a source the reference refuses and the message, position and span it
# gave, under an authored `reason` label naming which message family the row
# stands for - the label is this repository's token for the family and is not a
# word the reference said. A `decompile` row holds a source, one combination of
# the `parentheses` and `spacing` options, and the text the reference rendered.
#
# WHAT HAPPENS WHEN THE REFERENCE RAISES. `Predicator.compile/1` is not total:
# a decimal literal naming a magnitude outside the finite double range makes it
# raise rather than answer a failing arm. A raise is neither an answer nor a
# refusal, so it has no row shape here, and what this package should answer for
# such a source is recorded as an open question elsewhere rather than settled
# by this file. So every call below runs inside a rescue, and a raise is
# collected as a problem rather than ending the run: the authored list is
# walked to its end, every raising source is reported with its exception, and
# the run then halts without writing a file. The point is that a raise is
# reported as a problem with the authored list rather than discovered as a
# stack trace partway through it, and that no row invents an answer the
# reference did not give.
#
# Every example stays inside the two canonical domains: card processing, and a
# signup wizard.

[output_dir] = System.argv()

alias Predicator.Conformance.JSON, as: CanonicalJSON
alias Predicator.Conformance.Values

# --------------------------------------------------------------------------
# The authored sources the reference compiles.
#
# Each covers a construct no vendored case reaches, or carries a value whose
# tagged encoding is worth pinning. The list is grouped the way the constructs
# group, and the groups are what the row count is stated beside.
# --------------------------------------------------------------------------

compile_sources = [
  # A single-quoted string literal, and every escape the lexer recognizes,
  # plus the two it does not: an unknown escape stands for its own character,
  # and the uppercase numeric escape is not the refusal its lowercase spelling
  # is. The lowercase one is a refusal row below.
  {"string/single-quoted", ~S('visa')},
  {"escape/double-quote", ~S("visa \"gold\"")},
  {"escape/single-quote", ~S('visa \'gold\'')},
  {"escape/backslash", ~S("visa\\gold")},
  {"escape/newline", ~S("visa\ngold")},
  {"escape/tab", ~S("visa\tgold")},
  {"escape/carriage-return", ~S("visa\rgold")},
  {"escape/unknown-stands-for-its-character", ~S("visa\qgold")},
  {"escape/uppercase-u-passes-through", ~S("caf\U00e9")},

  # The word operators uppercase, the symbol operators, and the negation
  # operator at its own level and below a comparison.
  {"operator/uppercase-and", "score > 85 AND tier == 'gold'"},
  {"operator/uppercase-or", "score > 85 OR tier == 'gold'"},
  {"operator/uppercase-not", "NOT flagged"},
  {"operator/uppercase-in", "tier IN ['gold', 'platinum']"},
  {"operator/uppercase-contains", "issuer CONTAINS 'visa'"},
  {"operator/ampersand-ampersand", "flagged && verified"},
  {"operator/pipe-pipe", "flagged || verified"},
  {"operator/bang-at-not-level", "!flagged"},
  {"operator/bang-below-comparison", "!score > 85"},

  # Grouping parentheses, including a redundant pair the compiler drops.
  {"grouping/parentheses", "(score > 85 OR verified) AND tier == 'gold'"},
  {"grouping/redundant", "((score > 85))"},

  # Lists and objects: nested, empty, and both spellings of an object key.
  {"list/nested", "[1, [2, []]]"},
  {"list/empty", "[]"},
  {"object/empty", "{}"},
  {"object/quoted-key", ~S({"tier": 'gold'})},
  {"object/bare-key", "{tier: 'gold'}"},

  # Access chains of depth two and three, in both spellings.
  {"access/dot-depth-two", "user.profile.tier"},
  {"access/dot-depth-three", "user.profile.card.tier"},
  {"access/bracket-depth-two", ~S(user['profile']['tier'])},

  # Calls: zero-arg, nested, and qualified by a namespace.
  {"call/zero-arg", "Date.now()"},
  {"call/nested", "len(upper(tier))"},
  {"call/qualified", "Math.max(score, 85)"},

  # Every relative-date form, one per arm the opcode carries.
  {"relative-date/ago", "3d ago"},
  {"relative-date/next", "next 1w"},
  {"relative-date/last", "last 1w"},
  {"relative-date/from-now", "1d from now"},

  # A right operand of two or more instructions under each of the two
  # short-circuiting operators, which is what fixes the jump's distance, and
  # the two mixed together so that the precedence is visible in the jumps.
  {"logical/and-right-operand-two-instructions", "verified AND score > 85"},
  {"logical/or-right-operand-two-instructions", "verified OR score > 85"},
  {"logical/mixed-precedence", "verified OR score > 85 AND tier == 'gold'"},
  {"logical/not-over-comparison", "NOT score > 85"},

  # A cast chained onto a cast.
  {"cast/chained", "score::integer::string"},

  # Every duration unit alone, every unit at once, a fraction that expands
  # into the next unit down, and a unit named twice without a fraction, which
  # is not the refusal its fractional spelling is.
  {"duration/years", "1y"},
  {"duration/months", "2mo"},
  {"duration/weeks", "3w"},
  {"duration/days", "4d"},
  {"duration/hours", "5h"},
  {"duration/minutes", "6m"},
  {"duration/seconds", "7s"},
  {"duration/milliseconds", "8ms"},
  {"duration/multi-unit", "1y2mo3w4d5h6m7s"},
  {"duration/fraction-expands", "1.5h"},
  {"duration/integer-duplicate", "1h2h"},

  # Every cast type name standing alone, where it is an ordinary identifier
  # rather than a type.
  {"cast-name-as-identifier/integer", "integer"},
  {"cast-name-as-identifier/float", "float"},
  {"cast-name-as-identifier/string", "string"},
  {"cast-name-as-identifier/boolean", "boolean"},
  {"cast-name-as-identifier/date", "date"},
  {"cast-name-as-identifier/datetime", "datetime"},
  {"cast-name-as-identifier/duration", "duration"},

  # The three literals whose compiled operand is a value JSON cannot carry
  # directly, so that the tagged encoding of an operand is pinned rather than
  # assumed.
  {"tagged-operand/date", "#2026-09-19#"},
  {"tagged-operand/datetime", "#2026-09-19T10:30:00Z#"},
  {"tagged-operand/absence", "undefined"},

  # A source nested far deeper than any other authored here, for the one
  # place this package does not accept what the reference accepts.
  #
  # This package declares how deep a source may nest and refuses one past
  # that depth; the reference declares nothing and compiles it. Every other
  # difference between the two is held by a row that runs, and until this
  # row there was none for this one - the deepest expression in the vendored
  # corpus nests four levels, two orders of magnitude short of the bound, so
  # no vendored case can reach it and no refresh of the corpus will. The
  # difference was held by prose alone, which is the same class of thing as
  # an assertion that cannot fail.
  #
  # WHY PARENTHESES. Nesting is what is pinned here, not length. A written
  # parenthesis opens a level in the reference's own descent and in this
  # package's grammar, and it opens no node in either emitter, so the row
  # stands on the nesting alone and does not move if a walk over a flat
  # chain is ever rewritten to stop descending. The compiled answer is two
  # instructions whatever the depth, which keeps the row's recorded program
  # small enough to read.
  #
  # WHY THREE HUNDRED. This file runs inside the reference and cannot read
  # the constant this package declares, so the depth is written here and the
  # reading side checks it: the case that consumes this row counts the
  # source's own nesting and asserts it is past the declared bound, so a
  # bound raised above this depth fails there rather than turning the row
  # quietly meaningless. Three hundred is past today's two hundred and
  # fifty-six with room to spare, and far below any depth at which the
  # reference was observed to stop - it was not observed to stop at all.
  {"nesting/parentheses-past-the-source-depth-bound",
   String.duplicate("(", 300) <> "charge.amount" <> String.duplicate(")", 300)}
]

# --------------------------------------------------------------------------
# The authored sources the reference refuses: one for each member of the
# closed reason union, and three more for the wordings the union's record
# calls out as belonging to a family it already names.
# --------------------------------------------------------------------------

refusal_sources = [
  # Six families from the lexer.
  {"unexpected_character", "score & 85"},
  {"unterminated_string", ~S("visa)},
  # The `~S` sigil leaves an escape alone except the lowercase numeric one,
  # which is the very escape this row is about, so this source is written with
  # the backslash doubled in an ordinary string instead.
  {"unsupported_escape", "\"caf\\u00e9\""},
  {"unterminated_date", "#2026-09-19"},
  {"invalid_date", "#2024-13-45#"},
  {"invalid_datetime", "#2024-13-45T10:00:00Z#"},

  # Sixteen families from the parser.
  {"expected_primary", "()"},
  {"trailing_token", "score 3"},
  {"statement_keyword", "if"},
  {"assignment_in_expression", "score = 3"},
  {"expected_close_paren", "(1]"},
  {"expected_close_bracket", "[1)"},
  {"expected_close_brace", "{tier: 'gold'"},
  {"expected_object_key", "{1: 2}"},
  {"expected_object_colon", "{tier 1}"},
  {"expected_property_name", "user."},
  {"expected_type_name", "score::"},
  {"unknown_cast_type", "score::foo"},
  {"expected_now", "1d from yesterday"},
  {"expected_duration", "next 5"},
  {"duration_fraction", "0.5ms"},
  {"duration_unit_twice", "1.5d2h"},

  # Four spellings that belong to a family above rather than to one of their
  # own: the single-quoted wording of the unterminated string, the datetime
  # literal reported with the date wording, the assignment refused at an access
  # chain rather than at a bare name, and a comparison chained onto a
  # comparison, which is refused because comparison does not associate - the
  # second operator is a token after a finished expression rather than a site
  # of its own.
  {"unterminated_string/single-quoted", ~S('visa)},
  {"unterminated_date/datetime", "#2026-09-19T10:30:00Z"},
  {"assignment_in_expression/access-chain", "user.age = 30"},
  {"trailing_token/comparison-chain", "score < 85 < 90"}
]

# --------------------------------------------------------------------------
# The decompile matrix: each source against every combination of the two
# options. The sources are chosen so that each option has something to change:
# a nested expression for the parentheses option, word operators and operands
# for the spacing option, a source whose two string literals carry different
# quote characters and a source whose object key is written bare, both of
# which survive rendering and do not survive compilation.
# --------------------------------------------------------------------------

decompile_sources = [
  {"nested", "score > 85 AND (tier == 'gold' OR NOT flagged)"},
  {"lowercase-operators", "score > 85 and tier == 'gold'"},
  {"quote-characters", ~S('gold' == "gold")},
  {"bare-object-key", "{tier: 'gold'}"},
  {"chain", "user.profile.score::integer > Math.max(1, 2)"}
]

parentheses_options = [:minimal, :explicit, :none]
spacing_options = [:normal, :compact, :verbose]

# --------------------------------------------------------------------------
# Running the reference. `attempt/1` is what makes a raise a collected problem
# rather than the end of the run.
# --------------------------------------------------------------------------

attempt = fn body ->
  try do
    {:answered, body.()}
  rescue
    exception -> {:raised, inspect(exception.__struct__), Exception.message(exception)}
  end
end

encode_position = fn {line, column} -> %{"line" => line, "column" => column} end

encode_instructions = fn instructions ->
  case Values.to_json(instructions) do
    {:ok, encoded} -> {:ok, encoded}
    {:error, reason} -> {:error, "instructions are not encodable: #{inspect(reason)}"}
  end
end

compile_rows =
  for {label, source} <- compile_sources do
    case attempt.(fn -> Predicator.compile(source) end) do
      {:answered, {:ok, instructions}} ->
        case encode_instructions.(instructions) do
          {:ok, encoded} ->
            {:ok,
             %{
               "id" => "compile/#{label}",
               "kind" => "compile",
               "source" => source,
               "instructions" => encoded
             }}

          {:error, problem} ->
            {:problem, "compile/#{label}", problem}
        end

      {:answered, {:error, error}} ->
        {:problem, "compile/#{label}",
         "the reference refused a source authored as one it compiles: #{error.message}"}

      {:raised, struct_name, message} ->
        {:problem, "compile/#{label}", "the reference raised #{struct_name}: #{message}"}
    end
  end

refusal_rows =
  for {label, source} <- refusal_sources do
    case attempt.(fn -> Predicator.compile(source) end) do
      {:answered, {:error, error}} ->
        {start_position, end_position} = error.span

        {:ok,
         %{
           "id" => "refusal/#{label}",
           "kind" => "refusal",
           "reason" => label |> String.split("/") |> hd(),
           "source" => source,
           "message" => error.message,
           "position" => encode_position.(error.position),
           "span" => %{
             "start" => encode_position.(start_position),
             "end" => encode_position.(end_position)
           }
         }}

      {:answered, {:ok, _instructions}} ->
        {:problem, "refusal/#{label}",
         "the reference compiled a source authored as one it refuses"}

      {:raised, struct_name, message} ->
        {:problem, "refusal/#{label}", "the reference raised #{struct_name}: #{message}"}
    end
  end

decompile_rows =
  for {label, source} <- decompile_sources,
      parentheses <- parentheses_options,
      spacing <- spacing_options do
    id = "decompile/#{label}/#{parentheses}/#{spacing}"

    rendered =
      attempt.(fn ->
        with {:ok, ast} <- Predicator.parse(source) do
          {:ok, Predicator.decompile(ast, parentheses: parentheses, spacing: spacing)}
        end
      end)

    case rendered do
      {:answered, {:ok, text}} ->
        {:ok,
         %{
           "id" => id,
           "kind" => "decompile",
           "source" => source,
           "options" => %{
             "parentheses" => Atom.to_string(parentheses),
             "spacing" => Atom.to_string(spacing)
           },
           "rendered" => text
         }}

      {:answered, {:error, error}} ->
        {:problem, id, "the reference refused a source authored as one it renders: #{error.message}"}

      {:raised, struct_name, message} ->
        {:problem, id, "the reference raised #{struct_name}: #{message}"}
    end
  end

results = compile_rows ++ refusal_rows ++ decompile_rows

problems = for {:problem, id, problem} <- results, do: {id, problem}

if problems != [] do
  for {id, problem} <- problems, do: IO.puts(:stderr, "#{id}: #{problem}")

  IO.puts(
    :stderr,
    "the authored list has #{length(problems)} problem(s); no transcript was written"
  )

  System.halt(1)
end

rows = for {:ok, row} <- results, do: row

File.write!(Path.join(output_dir, "compile.json"), CanonicalJSON.encode_lines(rows))

counts = %{
  "compile" => length(compile_sources),
  "refusal" => length(refusal_sources),
  "decompile" => length(decompile_sources) * length(parentheses_options) * length(spacing_options),
  "rows" => length(rows)
}

toolchain = %{
  "elixir" => System.version(),
  "otp" => to_string(:erlang.system_info(:otp_release)),
  "isa_version" => Predicator.isa_version(),
  "counts" => counts
}

File.write!(
  Path.join(output_dir, "toolchain.json"),
  CanonicalJSON.encode_canonical(toolchain)
)
