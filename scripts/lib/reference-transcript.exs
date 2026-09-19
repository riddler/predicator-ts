# The reference half of the transcript: run inside an export of the reference
# implementation, never inside this repository.
#
#   mix run <this file> <output directory>
#
# `scripts/reference-transcript.mjs` is what runs this, with the export as the
# working directory, and it is the only intended caller: it checks the export
# against the tag it was asked for and writes what this leaves behind into
# `conformance/transcript/`. Run by hand, this writes two files into the output
# directory and nothing else.
#
# WHAT THIS DOES. It hands a fixed set of authored cases to the reference's own
# corpus generator, `Predicator.Conformance.Generator.generate/1`, which
# compiles each case's source, runs it and records the answer, exactly as the
# reference does for the vendored corpus. Nothing here computes an answer; the
# generator does, and the reference's own canonical writer,
# `Predicator.Conformance.JSON.encode_lines/1`, writes each completed case as
# one line. So a row of the transcript has the shape of a vendored case and
# the answer the reference gives at the export's tag.
#
# WHAT IT COVERS is where this package states how its answer compares with the
# reference's and no vendored case reaches: how a float is written as text,
# through the string cast and through `JSON.stringify`; the unit a string
# position is counted in, through the length, index and slice builtins; the
# set of characters trimming removes; which spellings of a UTC offset the
# datetime cast reads; what `JSON.stringify` answers for a value with no JSON
# form; whether a sign before a whole date or datetime text is read; what an
# integer key finds against a map; what an arithmetic result past this
# package's safe integer range answers; and whether two reads of the clock in
# one evaluation answer one instant. The values are chosen to show the
# reference's own behaviour rather than to agree with this package's: a
# rendering is a function of significant digits against decimal exponent
# there, so neighbouring values that land on opposite sides of it are both
# here.
#
# ONE ROW RECORDS A PROPERTY OF THE RUN RATHER THAN OF THE TAG. The `clock/`
# row asks the reference whether two reads of its clock inside one expression
# answer the same instant, and the reference reads its host clock on each
# call, so it answers that they differ. Every other row is reproducible from
# the tag alone; that one is reproducible only in the sense that two clock
# reads separated by an instruction land in different microseconds. A
# regeneration that answered otherwise is a coincidence to re-run before it is
# read as a change in the reference.
#
# Every example stays inside the two canonical domains: card processing, and a
# signup wizard.

[output_dir] = System.argv()

floats = [
  {"0", 0.0},
  {"neg-0", -0.0},
  {"1", 1.0},
  {"1.5", 1.5},
  {"neg-1.5", -1.5},
  {"10", 10.0},
  {"100", 100.0},
  {"1000", 1000.0},
  {"1001", 1001.0},
  {"10000", 10000.0},
  {"12345", 12345.0},
  {"123456789", 123_456_789.0},
  {"1e15", 1.0e15},
  {"1e16", 1.0e16},
  {"1e20", 1.0e20},
  {"1e21", 1.0e21},
  {"neg-1e21", -1.0e21},
  {"1e22", 1.0e22},
  {"0.1", 0.1},
  {"0.1-plus-0.2", 0.1 + 0.2},
  {"0.001", 0.001},
  {"1e-4", 1.0e-4},
  {"1e-5", 1.0e-5},
  {"1e-6", 1.0e-6},
  {"1e-7", 1.0e-7},
  {"1.5e-7", 1.5e-7},
  {"3.25e-8", 3.25e-8},
  {"largest", 1.7976931348623157e308},
  {"smallest", 5.0e-324}
]

float_cases =
  for {label, value} <- floats,
      {kind, source} <- [{"float-cast", "amount::string"}, {"float-json", "JSON.stringify(amount)"}] do
    %{"id" => "#{kind}/#{label}", "source" => source, "context" => %{"amount" => value}}
  end

# A letter and a combining acute accent: two code points, one grapheme.
combining = "Jose\u0301"
# A precomposed letter: one code point, two bytes in UTF-8.
precomposed = "Zo\u00EB"
# A credit card emoji: one code point outside the basic plane, four bytes in
# UTF-8, two UTF-16 code units.
astral = "\u{1F4B3}"
# A carriage return and a line feed: two code points, both ASCII, one grapheme.
crlf = "\r\n"
# A flag: two regional indicator symbols, two code points, one grapheme.
flag = "\u{1F1FA}\u{1F1F8}"

string_cases = [
  {"string-unit/len-ascii", "len(name)", "visa"},
  {"string-unit/len-precomposed", "len(name)", precomposed},
  {"string-unit/len-combining", "len(name)", combining},
  {"string-unit/len-astral", "len(name)", "#{astral} visa"},
  {"string-unit/index-ascii", "index_of(name, 'gold')", "visa gold"},
  {"string-unit/index-after-precomposed", "index_of(name, 'Visa')", "#{precomposed} Visa"},
  {"string-unit/index-after-combining", "index_of(name, 'Visa')", "#{combining} Visa"},
  {"string-unit/index-after-astral", "index_of(name, 'visa')", "#{astral} visa"},
  {"string-unit/slice-ascii", "substring(name, 5)", "visa gold"},
  {"string-unit/slice-after-precomposed", "substring(name, 4)", "#{precomposed} Visa"},
  {"string-unit/slice-after-combining", "substring(name, 5)", "#{combining} Visa"},
  {"string-unit/slice-length-over-combining", "substring(name, 0, 4)", "#{combining} Visa"},
  {"string-unit/slice-after-astral", "substring(name, 2)", "#{astral} visa"},
  {"string-unit/len-crlf", "len(name)", "visa#{crlf}gold"},
  {"string-unit/slice-after-crlf", "substring(name, 5)", "visa#{crlf}gold"},
  {"string-unit/len-flag", "len(name)", "#{flag} visa"},
  {"string-unit/slice-after-flag", "substring(name, 2)", "#{flag} visa"},
  {"trim/ascii", "trim(name)", "  visa  "},
  {"trim/zero-width-no-break-space", "trim(name)", "\uFEFFvisa\uFEFF"},
  {"trim/next-line", "trim(name)", "\u0085visa\u0085"}
]

string_cases =
  for {id, source, name} <- string_cases do
    %{"id" => id, "source" => source, "context" => %{"name" => name}}
  end

# The offset position of the datetime cast. Every text the vendored corpus
# casts to a datetime with an offset writes that offset as `Z`, and the
# reference reads the text with its host language's ISO parser, whose offset
# clauses are what these exercise: each spelling a clause names, the one a
# clause singles out for refusal, spellings that fall through every clause
# or fail its range check, and a field holding a sign where its first digit
# belongs, which the parser's integer read of each field lets through. The
# local time is the same on every row, so rows that name the same offset
# answer the same instant.
stamp = "2026-09-19T10:30:00"

offsets = [
  {"z-upper", "Z"},
  {"z-lower", "z"},
  {"plus-colon", "+05:30"},
  {"minus-colon", "-05:30"},
  {"plus-colonless", "+0530"},
  {"minus-colonless", "-0530"},
  {"plus-hour", "+05"},
  {"minus-hour", "-05"},
  {"plus-zero-colon", "+00:00"},
  {"minus-zero-colon", "-00:00"},
  {"minus-zero-colonless", "-0000"},
  {"minus-zero-hour", "-00"},
  {"space-before", " +05:30"},
  {"space-before-z", " Z"},
  {"trailing-space", "+05:30 "},
  {"with-seconds", "+05:30:00"},
  {"colonless-with-seconds", "+053000"},
  {"three-digits", "+053"},
  {"one-digit-hour", "+5:30"},
  {"hour-out-of-range", "+24:00"},
  {"minute-out-of-range", "+05:60"},
  {"space-in-hour-field", "+ 5:30"},
  {"minus-in-hour-field", "+-5:30"},
  {"plus-in-hour-field", "++5:30"},
  {"plus-in-minute-field", "+05:+3"},
  {"minus-in-minute-field", "+05:-3"},
  {"minus-in-hour-field-colonless", "+-530"},
  {"minus-in-hour-field-hour-only", "+-5"},
  {"plus-in-hour-field-under-minus", "-+5:30"},
  {"minus-sign-character", "−0530"},
  {"zone-name", "UTC"},
  {"missing", ""},
  {"after-fraction", ".5+05:30"}
]

offset_cases =
  for {label, offset} <- offsets do
    %{
      "id" => "datetime-offset/#{label}",
      "source" => "authorized_at::datetime",
      "context" => %{"authorized_at" => stamp <> offset}
    }
  end

# WHAT `JSON.stringify` ANSWERS FOR A VALUE WITH NO JSON FORM. This package
# refuses a temporal member and the absence there, and the refusal is a
# declared divergence, so what the reference answers instead is asked rather
# than described: a date, an instant, a duration and an unbound name, each
# handed to the builtin.
json_form_cases = [
  %{
    "id" => "json-form/datetime",
    "source" => "JSON.stringify(authorized_at::datetime)",
    "context" => %{"authorized_at" => "2026-09-19T10:30:00Z"}
  },
  %{
    "id" => "json-form/date",
    "source" => "JSON.stringify(opened_on::date)",
    "context" => %{"opened_on" => "2026-09-19"}
  },
  %{"id" => "json-form/duration", "source" => "JSON.stringify(2d)", "context" => %{}},
  %{"id" => "json-form/absence", "source" => "JSON.stringify(nickname)", "context" => %{}}
]

# A SIGN BEFORE THE WHOLE TEXT. The date and datetime casts here refuse a
# leading sign, and the reference reads it as the sign of the year. The
# spelling asked of the reference is the plus, which names a year both sides
# admit without it, put to the date cast and to the datetime cast.
#
# NEITHER MINUS SPELLING IS A ROW, and the reason is the wire form a row is
# read back through rather than a choice about what to ask. That form writes a
# year as four unsigned digits and, by its own further condition, holds only
# years from one hundred up. So the two values the reference answers for a
# minus are both outside it: `-2026-09-19` reads there as a negative year, and
# `-0000-01-01` as the year zero. A row carrying either stops the whole file
# from being read rather than declaring one divergence, so the refusal of a
# minus stays pinned on the side that can be executed and the plus rows carry
# the reference's half.
leading_sign_cases =
  for {label, source, key, text} <- [
        {"date-plus", "opened_on::date", "opened_on", "+2026-09-19"},
        {"datetime-plus", "authorized_at::datetime", "authorized_at",
         "+2026-09-19T10:30:00Z"}
      ] do
    %{"id" => "leading-sign/#{label}", "source" => source, "context" => %{key => text}}
  end

# AN INTEGER KEY AGAINST A MAP. This package looks an integer key up under its
# decimal spelling, so a map holding only the string-spelled key answers a
# value here. The reference's maps hold the two spellings as two keys, so what
# it answers is asked. The boolean row is the control beside it: a map whose
# key is the text of a boolean, asked for by the boolean, which neither side
# finds.
map_key_cases = [
  %{
    "id" => "map-key/integer-against-string-spelling",
    "source" => "tiers[0]",
    "context" => %{"tiers" => %{"0" => "gold", "name" => "visa"}}
  },
  %{
    "id" => "map-key/boolean-against-string-spelling",
    "source" => "tiers[true]",
    "context" => %{"tiers" => %{"true" => "gold", "name" => "visa"}}
  }
]

# AN ARITHMETIC RESULT PAST THE SAFE INTEGER RANGE. This package refuses one;
# the reference's integers are arbitrary precision, so it answers the exact
# number. The result is asked for as text, because a row whose answer is an
# integer this package cannot hold is a row this package cannot decode.
integer_range_cases = [
  %{
    "id" => "integer-range/sum-past-safe",
    "source" => "(balance + 1)::string",
    "context" => %{"balance" => 9_007_199_254_740_991}
  },
  %{
    "id" => "integer-range/product-past-safe",
    "source" => "(balance * 2)::string",
    "context" => %{"balance" => 9_007_199_254_740_991}
  },
  %{
    "id" => "integer-range/sum-at-bound",
    "source" => "(balance + 0)::string",
    "context" => %{"balance" => 9_007_199_254_740_991}
  }
]

# TWO READS OF THE CLOCK IN ONE EVALUATION. This package reads the host clock
# at most once per evaluation and both calls answer that instant; the
# reference reads its own on every call. Nothing pins either answer, so the
# question asked is the one that has an answer: whether the two reads agree.
clock_cases = [
  %{"id" => "clock/two-reads-in-one-evaluation", "source" => "Date.now() == Date.now()", "context" => %{}}
]

authored =
  float_cases ++
    string_cases ++
    offset_cases ++ json_form_cases ++ leading_sign_cases ++ map_key_cases ++ integer_range_cases ++ clock_cases

completed =
  case Predicator.Conformance.Generator.generate(authored) do
    {:ok, %{tiers: tiers}} ->
      tiers |> Map.values() |> List.flatten()

    {:error, errors} ->
      for %{id: id, problem: problem} <- errors, do: IO.puts(:stderr, "#{id}: #{problem}")
      System.halt(1)
  end

# The generator groups cases by tier; the transcript keeps the authored order,
# so that a regeneration's diff lines up row for row.
position = authored |> Enum.with_index() |> Map.new(fn {item, at} -> {item["id"], at} end)
rows = Enum.sort_by(completed, &Map.fetch!(position, &1["id"]))

File.write!(Path.join(output_dir, "transcript.json"), Predicator.Conformance.JSON.encode_lines(rows))

toolchain = %{
  "elixir" => System.version(),
  "otp" => to_string(:erlang.system_info(:otp_release)),
  "isa_version" => Predicator.isa_version()
}

File.write!(
  Path.join(output_dir, "toolchain.json"),
  Predicator.Conformance.JSON.encode_canonical(toolchain)
)
