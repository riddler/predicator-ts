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
# through the string cast, through `JSON.stringify` and through a concatenation,
# and whether that text reads back through the float cast; the unit a string
# position is counted in, through the length, index and slice builtins; the set
# of characters trimming removes; which spellings of a UTC offset the datetime
# cast reads; what `JSON.stringify` answers for a value with no JSON form;
# whether a sign before a whole date or datetime text is read; what an integer
# key and a null key find against a map, and a null key against a duration; what
# an arithmetic result past this package's safe integer range answers;
# whether two reads of the clock in one evaluation answer one instant; what a
# duration answers against a plain map; what a date plus a duration the
# host supplies answers; how two lists or two maps compare when a member
# holds the null value or is absent; how a date member compares with a
# datetime member, and a datetime member with one written to another
# precision; and how two lists order when a member holds the null value. The
# values are chosen to show the reference's own behaviour rather than to agree
# with this package's: below two to the fifty-third a float is written in
# whichever of the plain and exponent forms is shorter, the plain one on a tie,
# and from there up in exponent form, so neighbouring values that land on
# opposite sides of each choice are both here.
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
  {"999", 999.0},
  {"1000", 1000.0},
  {"1001", 1001.0},
  {"1234", 1234.0},
  {"1500", 1500.0},
  {"10000", 10000.0},
  {"12345", 12345.0},
  {"120000", 120_000.0},
  {"123456789", 123_456_789.0},
  {"1e14", 1.0e14},
  {"1e15", 1.0e15},
  {"2-pow-53-less-1", 9_007_199_254_740_991.0},
  {"2-pow-53", 9_007_199_254_740_992.0},
  {"1e16", 1.0e16},
  {"1e20", 1.0e20},
  {"1e21", 1.0e21},
  {"neg-1e21", -1.0e21},
  {"1e22", 1.0e22},
  {"1.5e300", 1.5e300},
  {"0.1", 0.1},
  {"0.1-plus-0.2", 0.1 + 0.2},
  {"0.001", 0.001},
  {"0.001234", 0.001234},
  {"1e-4", 1.0e-4},
  {"1.2e-4", 1.2e-4},
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
      {kind, source} <- [
        {"float-cast", "amount::string"},
        {"float-json", "JSON.stringify(amount)"},
        {"float-concat", "'' + amount"}
      ] do
    %{"id" => "#{kind}/#{label}", "source" => source, "context" => %{"amount" => value}}
  end

# A float's text read back through the float cast. The cast reads plain digits
# and no exponent form, so a float written with an exponent does not read
# back, and one written plain does; one of each is asked.
float_cast_back_cases =
  for {label, value} <- [{"1000", 1000.0}, {"1234", 1234.0}] do
    %{
      "id" => "float-cast-back/#{label}",
      "source" => "(amount::string)::float",
      "context" => %{"amount" => value}
    }
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
# finds. The null rows ask what the null value finds as a key: at a map, and
# at a duration the program built, which the reference indexes as a map.
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
  },
  %{
    "id" => "map-key/null-against-map",
    "source" => "tiers[null]",
    "context" => %{"tiers" => %{"null" => "gold", "name" => "visa"}}
  },
  %{"id" => "map-key/null-against-a-built-duration", "source" => "(3d)[null]", "context" => %{}}
]

# A FIELD OF A DURATION THE PROGRAM BUILT. This package reads a duration as
# the eight-key map its shape is, wherever the duration came from, so both
# spellings of the read answer the field here. A duration the host supplies
# reads its field on both sides, which the vendored corpus pins; one the
# duration opcode builds is asked of the reference, by field and by bracket.
duration_field_cases = [
  %{"id" => "duration-field/access-on-a-built-duration", "source" => "(3d).days", "context" => %{}},
  %{
    "id" => "duration-field/bracket-on-a-built-duration",
    "source" => ~S|(3d)["days"]|,
    "context" => %{}
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

# A DURATION AGAINST A PLAIN MAP. This package's duration is its own class,
# which matches no plain map, so a loose comparison or an ordering of the two
# answers the absence, a strict comparison answers false, and membership
# finds nothing. The reference decides by how the map's keys are spelled: a
# duration the duration opcode builds is keyed by its host language's atoms,
# and its context normalization rewrites a duration the host supplies into a
# map keyed by strings, which then equals a plain map holding the same eight
# keys and values. So each operator is asked twice, once of a duration the
# program built and once of one the host supplied, each against a plain map
# holding the same eight keys and values: loose and strict equality and
# inequality, each of the four orderings, and membership from either side, as
# `in` and as `contains`. The duration is the hold period of a card
# authorization.
hold_policy = %{
  "years" => 0,
  "months" => 0,
  "weeks" => 0,
  "days" => 3,
  "hours" => 8,
  "minutes" => 0,
  "seconds" => 0,
  "milliseconds" => 0
}

hold_period = %{"$type" => "duration", "value" => hold_policy}

duration_against_map_cases =
  for {pair, left, context} <- [
        {"built", "3d8h", %{"hold_policy" => hold_policy}},
        {"supplied", "hold_period", %{"hold_period" => hold_period, "hold_policy" => hold_policy}}
      ],
      {operator, source} <- [
        {"loose-eq", "#{left} == hold_policy"},
        {"loose-ne", "#{left} != hold_policy"},
        {"strict-eq", "#{left} === hold_policy"},
        {"strict-ne", "#{left} !== hold_policy"},
        {"gte", "#{left} >= hold_policy"},
        {"lt", "#{left} < hold_policy"},
        {"in", "#{left} in [hold_policy]"},
        {"gt", "#{left} > hold_policy"},
        {"lte", "#{left} <= hold_policy"},
        {"contains", "[hold_policy] contains #{left}"}
      ] do
    %{"id" => "duration-against-map/#{pair}-#{operator}", "source" => source, "context" => context}
  end

# A DATE PLUS A DURATION THE HOST SUPPLIES. The same normalization leaves the
# reference holding a plain map where the host handed it a duration, and its
# date arithmetic takes no map, so it refuses the sum with a type mismatch;
# this package keeps the duration and answers the date moved on. A duration
# the program builds moves the date on both sides, which the vendored corpus
# pins.
date_arithmetic_cases = [
  %{
    "id" => "duration-arithmetic/date-plus-a-supplied-duration",
    "source" => "authorized_on::date + hold_period",
    "context" => %{"authorized_on" => "2026-09-19", "hold_period" => hold_period}
  }
]

# TWO LISTS OR TWO MAPS WHOSE MEMBERS HOLD THE NULL VALUE OR ARE ABSENT. The
# reference compares the members of two containers by term, so two members
# holding the null value are equal, and so are two absent members, while the
# null value and the absence at the top level still answer as they always
# have. Each pair is asked through loose and strict equality and inequality
# and through membership: maps and lists holding the null value, at depth and
# beside other members, from literals and from the context; an absent member,
# spelled `undefined` and as an unbound name; the null value against an absent
# member; a map against a map with the key missing; mixed containers and the
# null value; a date, a datetime and a duration member that compare equal on
# both sides; and orderings whose first members are a list and a map holding
# the null value or an absent member, which an ordering walks with member
# equality, under each of the four ordering operators. The fields are a
# signup's billing and shipping addresses.
member_equality_cases =
  for {{source, context}, at} <-
        Enum.with_index(
          [
            {~S|{line2: null} == {line2: null}|, %{}},
            {~S|{line2: null} != {line2: null}|, %{}},
            {~S|{line2: null} === {line2: null}|, %{}},
            {~S|{line2: null} !== {line2: null}|, %{}},
            {~S|{line2: null} == {}|, %{}},
            {~S|{line2: null} != {}|, %{}},
            {~S|{line2: null} === {}|, %{}},
            {~S|{line2: null} !== {}|, %{}},
            {~S|{} == {}|, %{}},
            {~S|{} != {}|, %{}},
            {~S|{} === {}|, %{}},
            {~S|{} !== {}|, %{}},
            {~S|{plan: 1} == {plan: 1}|, %{}},
            {~S|{plan: 1} != {plan: 1}|, %{}},
            {~S|{plan: 1} === {plan: 1}|, %{}},
            {~S|{plan: 1} !== {plan: 1}|, %{}},
            {~S|{plan: 1} == {plan: 1.0}|, %{}},
            {~S|{plan: 1} != {plan: 1.0}|, %{}},
            {~S|{plan: 1} === {plan: 1.0}|, %{}},
            {~S|{plan: 1} !== {plan: 1.0}|, %{}},
            {~S|{plan: 1, tier: 2} == {tier: 2, plan: 1}|, %{}},
            {~S|{plan: 1, tier: 2} != {tier: 2, plan: 1}|, %{}},
            {~S|{plan: 1, tier: 2} === {tier: 2, plan: 1}|, %{}},
            {~S|{plan: 1, tier: 2} !== {tier: 2, plan: 1}|, %{}},
            {~S|{plan: {tier: null}} == {plan: {tier: null}}|, %{}},
            {~S|{plan: {tier: null}} != {plan: {tier: null}}|, %{}},
            {~S|{plan: {tier: null}} === {plan: {tier: null}}|, %{}},
            {~S|{plan: {tier: null}} !== {plan: {tier: null}}|, %{}},
            {~S|{line2: null} == {line3: null}|, %{}},
            {~S|{line2: null} != {line3: null}|, %{}},
            {~S|{line2: null} === {line3: null}|, %{}},
            {~S|{line2: null} !== {line3: null}|, %{}},
            {~S|{line2: null, line3: 1} == {line2: null, line3: 1}|, %{}},
            {~S|{line2: null, line3: 1} != {line2: null, line3: 1}|, %{}},
            {~S|{line2: null, line3: 1} === {line2: null, line3: 1}|, %{}},
            {~S|{line2: null, line3: 1} !== {line2: null, line3: 1}|, %{}},
            {~S|{line2: null} == {line2: 1}|, %{}},
            {~S|{line2: null} != {line2: 1}|, %{}},
            {~S|{line2: null} === {line2: 1}|, %{}},
            {~S|{line2: null} !== {line2: 1}|, %{}},
            {~S|[null] == [null]|, %{}},
            {~S|[null] != [null]|, %{}},
            {~S|[null] === [null]|, %{}},
            {~S|[null] !== [null]|, %{}},
            {~S|[] == []|, %{}},
            {~S|[] != []|, %{}},
            {~S|[] === []|, %{}},
            {~S|[] !== []|, %{}},
            {~S|[1, null] == [1, null]|, %{}},
            {~S|[1, null] != [1, null]|, %{}},
            {~S|[1, null] === [1, null]|, %{}},
            {~S|[1, null] !== [1, null]|, %{}},
            {~S|[[null]] == [[null]]|, %{}},
            {~S|[[null]] != [[null]]|, %{}},
            {~S|[[null]] === [[null]]|, %{}},
            {~S|[[null]] !== [[null]]|, %{}},
            {~S|[1] == [1.0]|, %{}},
            {~S|[1] != [1.0]|, %{}},
            {~S|[1] === [1.0]|, %{}},
            {~S|[1] !== [1.0]|, %{}},
            {~S|[{line2: null}] == [{line2: null}]|, %{}},
            {~S|[{line2: null}] != [{line2: null}]|, %{}},
            {~S|[{line2: null}] === [{line2: null}]|, %{}},
            {~S|[{line2: null}] !== [{line2: null}]|, %{}},
            {~S|[null] == [1]|, %{}},
            {~S|[null] != [1]|, %{}},
            {~S|[null] === [1]|, %{}},
            {~S|[null] !== [1]|, %{}},
            {~S|[null, 1] == [null, 2]|, %{}},
            {~S|[null, 1] != [null, 2]|, %{}},
            {~S|[null, 1] === [null, 2]|, %{}},
            {~S|[null, 1] !== [null, 2]|, %{}},
            {~S|billing == shipping|, %{"billing" => %{"line2" => nil}, "shipping" => %{"line2" => nil}}},
            {~S|billing != shipping|, %{"billing" => %{"line2" => nil}, "shipping" => %{"line2" => nil}}},
            {~S|billing === shipping|, %{"billing" => %{"line2" => nil}, "shipping" => %{"line2" => nil}}},
            {~S|billing == billing|, %{"billing" => %{"line2" => nil}, "shipping" => %{"line2" => nil}}},
            {~S|billing != billing|, %{"billing" => %{"line2" => nil}, "shipping" => %{"line2" => nil}}},
            {~S|billing == billing|, %{"billing" => %{"plan" => 1}}},
            {~S|holds == middle_name|, %{"holds" => nil, "middle_name" => nil}},
            {~S|holds != middle_name|, %{"holds" => nil, "middle_name" => nil}},
            {~S|holds === middle_name|, %{"holds" => nil, "middle_name" => nil}},
            {~S|holds !== middle_name|, %{"holds" => nil, "middle_name" => nil}},
            {~S|billing.referrer == shipping.referrer|, %{"billing" => %{"line2" => nil}, "shipping" => %{"line2" => nil}}},
            {~S|billing.referrer != shipping.referrer|, %{"billing" => %{"line2" => nil}, "shipping" => %{"line2" => nil}}},
            {~S|billing.referrer === shipping.referrer|, %{"billing" => %{"line2" => nil}, "shipping" => %{"line2" => nil}}},
            {~S|billing.referrer !== shipping.referrer|, %{"billing" => %{"line2" => nil}, "shipping" => %{"line2" => nil}}},
            {~S|billing.referrer == shipping.referrer|, %{"billing" => %{}, "shipping" => %{}}},
            {~S|billing.referrer != shipping.referrer|, %{"billing" => %{}, "shipping" => %{}}},
            {~S|billing.referrer === shipping.referrer|, %{"billing" => %{}, "shipping" => %{}}},
            {~S|billing.referrer !== shipping.referrer|, %{"billing" => %{}, "shipping" => %{}}},
            {~S|billing.line2 == shipping.line2|, %{"billing" => %{"line2" => nil}, "shipping" => %{"line2" => nil}}},
            {~S|visited == steps|, %{"steps" => [nil, 1], "visited" => [nil, 1]}},
            {~S|visited == steps|, %{"steps" => [%{"line2" => nil}], "visited" => [%{"line2" => nil}]}},
            {~S|{plan: 1} == [1]|, %{}},
            {~S|{plan: 1} != [1]|, %{}},
            {~S|{} == []|, %{}},
            {~S|{} != []|, %{}},
            {~S|{} === []|, %{}},
            {~S|{plan: 1} == null|, %{}},
            {~S|{plan: 1} != null|, %{}},
            {~S|{line2: null} == null|, %{}},
            {~S|[1] == null|, %{}},
            {~S|[1] != null|, %{}},
            {~S|[null] == null|, %{}},
            {~S|[] == null|, %{}},
            {~S|null == null|, %{}},
            {~S|null != null|, %{}},
            {~S|[[null], 1] < [[null], 2]|, %{}},
            {~S|[{line2: null}, 1] < [{line2: null}, 2]|, %{}},
            {~S|null in [null]|, %{}},
            {~S|{line2: null} in [{line2: null}]|, %{}},
            {~S|[null] in [[null]]|, %{}},
            {~S|{plan: 1} in [{plan: 1}]|, %{}},
            {~S|[1] in [[1.0]]|, %{}},
            {~S|[{line2: null}] contains {line2: null}|, %{}},
            {~S|[[null]] contains [null]|, %{}},
            {~S|[null] contains null|, %{}},
            {~S|[{plan: 1}] contains {plan: 1}|, %{}},
            {~S|{line2: null} in [{}]|, %{}},
            {~S|1 in [1.0]|, %{}},
            {~S|billing in [shipping]|, %{"billing" => %{"line2" => nil}, "shipping" => %{"line2" => nil}}},
            {~S|[billing] contains shipping|, %{"billing" => %{"line2" => nil}, "shipping" => %{"line2" => nil}}},
            {~S|billing !== shipping|, %{"billing" => %{"line2" => nil}, "shipping" => %{"line2" => nil}}},
            {~S|billing == shipping|, %{"billing" => %{"plan" => %{"tier" => nil}}, "shipping" => %{"plan" => %{"tier" => nil}}}},
            {~S|billing != shipping|, %{"billing" => %{"plan" => %{"tier" => nil}}, "shipping" => %{"plan" => %{"tier" => nil}}}},
            {~S|billing === shipping|, %{"billing" => %{"plan" => %{"tier" => nil}}, "shipping" => %{"plan" => %{"tier" => nil}}}},
            {~S|billing !== shipping|, %{"billing" => %{"plan" => %{"tier" => nil}}, "shipping" => %{"plan" => %{"tier" => nil}}}},
            {~S|billing == shipping|, %{"billing" => [nil], "shipping" => [nil]}},
            {~S|billing != shipping|, %{"billing" => [nil], "shipping" => [nil]}},
            {~S|billing === shipping|, %{"billing" => [nil], "shipping" => [nil]}},
            {~S|billing !== shipping|, %{"billing" => [nil], "shipping" => [nil]}},
            {~S|billing == shipping|, %{"billing" => [[nil], %{"line2" => nil}], "shipping" => [[nil], %{"line2" => nil}]}},
            {~S|billing != shipping|, %{"billing" => [[nil], %{"line2" => nil}], "shipping" => [[nil], %{"line2" => nil}]}},
            {~S|billing === shipping|, %{"billing" => [[nil], %{"line2" => nil}], "shipping" => [[nil], %{"line2" => nil}]}},
            {~S|billing !== shipping|, %{"billing" => [[nil], %{"line2" => nil}], "shipping" => [[nil], %{"line2" => nil}]}},
            {~S|billing == shipping|, %{"billing" => %{"line2" => nil}, "shipping" => %{}}},
            {~S|billing != shipping|, %{"billing" => %{"line2" => nil}, "shipping" => %{}}},
            {~S|billing === shipping|, %{"billing" => %{"line2" => nil}, "shipping" => %{}}},
            {~S|billing !== shipping|, %{"billing" => %{"line2" => nil}, "shipping" => %{}}},
            {~S|{line2: undefined} == {line2: undefined}|, %{}},
            {~S|{line2: undefined} != {line2: undefined}|, %{}},
            {~S|{line2: undefined} === {line2: undefined}|, %{}},
            {~S|{line2: undefined} !== {line2: undefined}|, %{}},
            {~S|{line2: referrer} == {line2: referrer}|, %{}},
            {~S|{line2: referrer} != {line2: referrer}|, %{}},
            {~S|{line2: referrer} === {line2: referrer}|, %{}},
            {~S|{line2: referrer} !== {line2: referrer}|, %{}},
            {~S|{plan: {tier: undefined}} == {plan: {tier: undefined}}|, %{}},
            {~S|{plan: {tier: undefined}} != {plan: {tier: undefined}}|, %{}},
            {~S|{plan: {tier: undefined}} === {plan: {tier: undefined}}|, %{}},
            {~S|{plan: {tier: undefined}} !== {plan: {tier: undefined}}|, %{}},
            {~S|{plan: {tier: referrer}} == {plan: {tier: referrer}}|, %{}},
            {~S|{plan: {tier: referrer}} != {plan: {tier: referrer}}|, %{}},
            {~S|{plan: {tier: referrer}} === {plan: {tier: referrer}}|, %{}},
            {~S|{plan: {tier: referrer}} !== {plan: {tier: referrer}}|, %{}},
            {~S|[undefined] == [undefined]|, %{}},
            {~S|[undefined] != [undefined]|, %{}},
            {~S|[undefined] === [undefined]|, %{}},
            {~S|[undefined] !== [undefined]|, %{}},
            {~S|[referrer] == [referrer]|, %{}},
            {~S|[referrer] != [referrer]|, %{}},
            {~S|[referrer] === [referrer]|, %{}},
            {~S|[referrer] !== [referrer]|, %{}},
            {~S|[[undefined]] == [[undefined]]|, %{}},
            {~S|[[undefined]] != [[undefined]]|, %{}},
            {~S|[[undefined]] === [[undefined]]|, %{}},
            {~S|[[undefined]] !== [[undefined]]|, %{}},
            {~S|[1, referrer] == [1, referrer]|, %{}},
            {~S|[1, referrer] != [1, referrer]|, %{}},
            {~S|[1, referrer] === [1, referrer]|, %{}},
            {~S|[1, referrer] !== [1, referrer]|, %{}},
            {~S|[{line2: referrer}] == [{line2: referrer}]|, %{}},
            {~S|[{line2: referrer}] != [{line2: referrer}]|, %{}},
            {~S|[{line2: referrer}] === [{line2: referrer}]|, %{}},
            {~S|[{line2: referrer}] !== [{line2: referrer}]|, %{}},
            {~S|{line2: undefined} == {}|, %{}},
            {~S|{line2: undefined} != {}|, %{}},
            {~S|{line2: undefined} === {}|, %{}},
            {~S|{line2: undefined} !== {}|, %{}},
            {~S|{line2: undefined} == {line2: null}|, %{}},
            {~S|{line2: undefined} != {line2: null}|, %{}},
            {~S|{line2: undefined} === {line2: null}|, %{}},
            {~S|{line2: undefined} !== {line2: null}|, %{}},
            {~S|[undefined] == [null]|, %{}},
            {~S|[undefined] != [null]|, %{}},
            {~S|[undefined] === [null]|, %{}},
            {~S|[undefined] !== [null]|, %{}},
            {~S|billing == {line2: undefined}|, %{"billing" => %{}}},
            {~S|billing == {line2: null}|, %{"billing" => %{"line2" => nil}}},
            {~S|{line2: undefined} in [{line2: undefined}]|, %{}},
            {~S|[{line2: undefined}] contains {line2: undefined}|, %{}},
            {~S|[undefined] in [[undefined]]|, %{}},
            {~S|#2026-03-01# == #2026-03-01T00:00:00Z#|, %{}},
            {~S|#2026-03-01# === #2026-03-01T00:00:00Z#|, %{}},
            {~S|#2026-03-01T00:00:00Z# == #2026-03-01T00:00:00.000Z#|, %{}},
            {~S|#2026-03-01T00:00:00.000Z# == #2026-03-01T00:00:00.000000Z#|, %{}},
            {~S|3d == 3d|, %{}},
            {~S|3d === 3d|, %{}},
            {~S|1d == 24h|, %{}},
            {~S|1d === 24h|, %{}},
            {~S|3d8h == 3d8h|, %{}},
            {~S|{opened_on: #2026-03-01#} === {opened_on: #2026-03-01T00:00:00Z#}|, %{}},
            {~S|[#2026-03-01#] === [#2026-03-01T00:00:00Z#]|, %{}},
            {~S|{holds: [#2026-03-01#]} === {holds: [#2026-03-01T00:00:00Z#]}|, %{}},
            {~S|#2026-03-01# in [#2026-03-01T00:00:00Z#]|, %{}},
            {~S|#2026-03-01T00:00:00Z# in [#2026-03-01T00:00:00.000Z#]|, %{}},
            {~S|#2026-03-01T00:00:00.000Z# in [#2026-03-01T00:00:00.000000Z#]|, %{}},
            {~S|{opened_on: #2026-03-01#} == {opened_on: #2026-03-01#}|, %{}},
            {~S|[#2026-03-01#] == [#2026-03-01#]|, %{}},
            {~S|{holds: [#2026-03-01#]} == {holds: [#2026-03-01#]}|, %{}},
            {~S|{opened_on: #2026-03-01#} === {opened_on: #2026-03-01#}|, %{}},
            {~S|[#2026-03-01#] === [#2026-03-01#]|, %{}},
            {~S|{holds: [#2026-03-01#]} === {holds: [#2026-03-01#]}|, %{}},
            {~S|#2026-03-01# in [#2026-03-01#]|, %{}},
            {~S|{opened_on: #2026-03-01#} in [{opened_on: #2026-03-01#}]|, %{}},
            {~S|{opened_on: #2026-03-01T00:00:00Z#} == {opened_on: #2026-03-01T00:00:00Z#}|, %{}},
            {~S|[#2026-03-01T00:00:00Z#] == [#2026-03-01T00:00:00Z#]|, %{}},
            {~S|{holds: [#2026-03-01T00:00:00Z#]} == {holds: [#2026-03-01T00:00:00Z#]}|, %{}},
            {~S|{opened_on: #2026-03-01T00:00:00Z#} === {opened_on: #2026-03-01T00:00:00Z#}|, %{}},
            {~S|[#2026-03-01T00:00:00Z#] === [#2026-03-01T00:00:00Z#]|, %{}},
            {~S|{holds: [#2026-03-01T00:00:00Z#]} === {holds: [#2026-03-01T00:00:00Z#]}|, %{}},
            {~S|#2026-03-01T00:00:00Z# in [#2026-03-01T00:00:00Z#]|, %{}},
            {~S|{opened_on: #2026-03-01T00:00:00Z#} in [{opened_on: #2026-03-01T00:00:00Z#}]|, %{}},
            {~S|{opened_on: 3d} == {opened_on: 3d}|, %{}},
            {~S|[3d] == [3d]|, %{}},
            {~S|{holds: [3d]} == {holds: [3d]}|, %{}},
            {~S|{opened_on: 3d} === {opened_on: 3d}|, %{}},
            {~S|[3d] === [3d]|, %{}},
            {~S|{holds: [3d]} === {holds: [3d]}|, %{}},
            {~S|3d in [3d]|, %{}},
            {~S|{opened_on: 3d} in [{opened_on: 3d}]|, %{}},
            {~S|{opened_on: 1d} == {opened_on: 24h}|, %{}},
            {~S|[1d] == [24h]|, %{}},
            {~S|{holds: [1d]} == {holds: [24h]}|, %{}},
            {~S|{opened_on: 1d} === {opened_on: 24h}|, %{}},
            {~S|[1d] === [24h]|, %{}},
            {~S|{holds: [1d]} === {holds: [24h]}|, %{}},
            {~S|1d in [24h]|, %{}},
            {~S|{opened_on: 1d} in [{opened_on: 24h}]|, %{}},
            {~S|{opened_on: 3d8h} == {opened_on: 3d8h}|, %{}},
            {~S|[3d8h] == [3d8h]|, %{}},
            {~S|{holds: [3d8h]} == {holds: [3d8h]}|, %{}},
            {~S|{opened_on: 3d8h} === {opened_on: 3d8h}|, %{}},
            {~S|[3d8h] === [3d8h]|, %{}},
            {~S|{holds: [3d8h]} === {holds: [3d8h]}|, %{}},
            {~S|3d8h in [3d8h]|, %{}},
            {~S|{opened_on: 3d8h} in [{opened_on: 3d8h}]|, %{}},
            {~S|undefined == undefined|, %{}},
            {~S|undefined != undefined|, %{}},
            {~S|undefined === undefined|, %{}},
            {~S|undefined !== undefined|, %{}},
            {~S|undefined in [undefined]|, %{}},
            {~S|undefined in [1]|, %{}},
            {~S|1 in [undefined]|, %{}},
            {~S|undefined in undefined|, %{}},
            {~S|1 in undefined|, %{}},
            {~S|[undefined] contains undefined|, %{}},
            {~S|referrer === referrer|, %{}},
            {~S|holds in [holds]|, %{"holds" => nil}},
            {~S|[[undefined], 1] < [[undefined], 2]|, %{}},
            {~S|[[undefined], 1] > [[undefined], 2]|, %{}},
            {~S|[[undefined], 1] <= [[undefined], 1]|, %{}},
            {~S|[[undefined], 1] >= [[undefined], 1]|, %{}},
            {~S|[{line2: undefined}, 1] < [{line2: undefined}, 2]|, %{}},
            {~S|[{line2: undefined}, 1] > [{line2: undefined}, 2]|, %{}},
            {~S|[{line2: undefined}, 1] <= [{line2: undefined}, 1]|, %{}},
            {~S|[{line2: undefined}, 1] >= [{line2: undefined}, 1]|, %{}},
            {~S|[[referrer], 1] < [[referrer], 2]|, %{}},
            {~S|[[referrer], 1] > [[referrer], 2]|, %{}},
            {~S|[[referrer], 1] <= [[referrer], 1]|, %{}},
            {~S|[[referrer], 1] >= [[referrer], 1]|, %{}},
            {~S|[{line2: referrer}, 1] < [{line2: referrer}, 2]|, %{}},
            {~S|[{line2: referrer}, 1] > [{line2: referrer}, 2]|, %{}},
            {~S|[{line2: referrer}, 1] <= [{line2: referrer}, 1]|, %{}},
            {~S|[{line2: referrer}, 1] >= [{line2: referrer}, 1]|, %{}},
            {~S|[[null], 1] > [[null], 2]|, %{}},
            {~S|[[null], 1] <= [[null], 1]|, %{}},
            {~S|[[null], 1] >= [[null], 1]|, %{}},
            {~S|[{line2: null}, 1] > [{line2: null}, 2]|, %{}},
            {~S|[{line2: null}, 1] <= [{line2: null}, 1]|, %{}},
            {~S|[{line2: null}, 1] >= [{line2: null}, 1]|, %{}}
          ],
          1
        ) do
    %{
      "id" => "member-equality/#{at |> Integer.to_string() |> String.pad_leading(3, "0")}",
      "source" => source,
      "context" => context
    }
  end

# A DATE MEMBER AGAINST A DATETIME MEMBER. The reference compares the members
# of two containers by term, so a date member and a datetime member are
# different members even at the same instant, and an ordering that walks two
# lists puts a date member before a datetime member whatever their instants;
# at the top level a date and a datetime still compare chronologically. Each
# pair is asked through loose and strict equality and inequality, membership
# both ways, and the four ordering operators: in a map, in a list, at depth,
# either way round, at the same instant and on different days, as the first
# member of two lists that a later member would order otherwise, and inside a
# map that an ordering walks past. Beside them are the top-level pairs that do
# not move, and datetimes written to different precision, as members and at
# the top level: the reference keeps a datetime's precision and compares it
# as part of the value, which a datetime here does not carry. The fields are
# a patron's loan dates.
#
# TWO DATE MEMBERS, OR TWO DATETIME MEMBERS, UNDER AN ORDERING. From `v9.4.4`
# the reference orders two lists whose members are two dates, or two
# datetimes, by the instant each names, as it orders the same pair at the top
# level, where before it read a date's fields in term order, the day before
# the month and the year. A pair at the same instant is level, and the next
# member decides; a datetime pair written to different precision is level
# there too. The last rows ask each of the four ordering operators over dates
# and datetimes whose term order and instant order disagree, at depth, and
# with a level pair before the member that decides. The values are a loan's
# due dates.
date_member_cases =
  for {source, at} <-
        Enum.with_index(
          [
            ~S|{opened_on: #2026-03-01#} == {opened_on: #2026-03-01T00:00:00Z#}|,
            ~S|{opened_on: #2026-03-01#} != {opened_on: #2026-03-01T00:00:00Z#}|,
            ~S|{opened_on: #2026-03-01#} === {opened_on: #2026-03-01T00:00:00Z#}|,
            ~S|{opened_on: #2026-03-01#} !== {opened_on: #2026-03-01T00:00:00Z#}|,
            ~S|{opened_on: #2026-03-01T00:00:00Z#} == {opened_on: #2026-03-01#}|,
            ~S|[#2026-03-01#] == [#2026-03-01T00:00:00Z#]|,
            ~S|[#2026-03-01#] != [#2026-03-01T00:00:00Z#]|,
            ~S|[#2026-03-01T00:00:00Z#] == [#2026-03-01#]|,
            ~S|{holds: [#2026-03-01#]} == {holds: [#2026-03-01T00:00:00Z#]}|,
            ~S|{holds: [#2026-03-01#]} != {holds: [#2026-03-01T00:00:00Z#]}|,
            ~S|[[#2026-03-01#]] == [[#2026-03-01T00:00:00Z#]]|,
            ~S|[{opened_on: #2026-03-01#}] == [{opened_on: #2026-03-01T00:00:00Z#}]|,
            ~S|[#2026-03-02#] == [#2026-03-01T00:00:00Z#]|,
            ~S|{opened_on: #2026-03-01#} in [{opened_on: #2026-03-01T00:00:00Z#}]|,
            ~S|[#2026-03-01#] in [[#2026-03-01T00:00:00Z#]]|,
            ~S|[[#2026-03-01T00:00:00Z#]] contains [#2026-03-01#]|,
            ~S|[{opened_on: #2026-03-01T00:00:00Z#}] contains {opened_on: #2026-03-01#}|,
            ~S|#2026-03-01# in [#2026-03-01T00:00:00Z#]|,
            ~S|[#2026-03-01T00:00:00Z#] contains #2026-03-01#|,
            ~S|#2026-03-01# == #2026-03-01T00:00:00Z#|,
            ~S|#2026-03-01# < #2026-03-01T00:00:00Z#|,
            ~S|#2026-03-02# > #2026-03-01T00:00:00Z#|,
            ~S|[#2026-03-01#] < [#2026-03-01T00:00:00Z#]|,
            ~S|[#2026-03-01#] > [#2026-03-01T00:00:00Z#]|,
            ~S|[#2026-03-01#] <= [#2026-03-01T00:00:00Z#]|,
            ~S|[#2026-03-01#] >= [#2026-03-01T00:00:00Z#]|,
            ~S|[#2026-03-01T00:00:00Z#] < [#2026-03-01#]|,
            ~S|[#2026-03-01T00:00:00Z#] > [#2026-03-01#]|,
            ~S|[#2026-03-01T00:00:00Z#] <= [#2026-03-01#]|,
            ~S|[#2026-03-01T00:00:00Z#] >= [#2026-03-01#]|,
            ~S|[#2026-03-02#] < [#2026-03-01T00:00:00Z#]|,
            ~S|[#2026-03-02#] > [#2026-03-01T00:00:00Z#]|,
            ~S|[#2026-02-28T00:00:00Z#] < [#2026-03-01#]|,
            ~S|[#2026-02-28T00:00:00Z#] > [#2026-03-01#]|,
            ~S|[#2026-03-01#, 2] < [#2026-03-01T00:00:00Z#, 1]|,
            ~S|[#2026-03-01T00:00:00Z#, 1] < [#2026-03-01#, 2]|,
            ~S|[[#2026-03-01#], 2] < [[#2026-03-01T00:00:00Z#], 1]|,
            ~S|[[#2026-03-01T00:00:00Z#], 1] < [[#2026-03-01#], 2]|,
            ~S|[{opened_on: #2026-03-01#}, 1] < [{opened_on: #2026-03-01T00:00:00Z#}, 2]|,
            ~S|[{opened_on: #2026-03-01T00:00:00Z#}, 1] < [{opened_on: #2026-03-01#}, 2]|,
            ~S|[{opened_on: #2026-03-01#}, 1] <= [{opened_on: #2026-03-01T00:00:00Z#}, 1]|,
            ~S|[{opened_on: #2026-03-01#}, 1] >= [{opened_on: #2026-03-01T00:00:00Z#}, 1]|,
            ~S|[[{opened_on: #2026-03-01#}], 1] < [[{opened_on: #2026-03-01T00:00:00Z#}], 2]|,
            ~S|[[{opened_on: #2026-03-01T00:00:00Z#}], 1] < [[{opened_on: #2026-03-01#}], 2]|,
            ~S|[#2026-03-01T00:00:00Z#] == [#2026-03-01T00:00:00.000Z#]|,
            ~S|[#2026-03-01T00:00:00.000Z#] == [#2026-03-01T00:00:00.000000Z#]|,
            ~S|{opened_on: #2026-03-01T00:00:00Z#} == {opened_on: #2026-03-01T00:00:00.000Z#}|,
            ~S|[#2026-03-01T00:00:00Z#] === [#2026-03-01T00:00:00.000Z#]|,
            ~S|#2026-03-01T00:00:00Z# === #2026-03-01T00:00:00.000Z#|,
            ~S|#2026-03-01T00:00:00.000Z# === #2026-03-01T00:00:00.000000Z#|,
            ~S|#2026-03-01T00:00:00Z# == #2026-03-01T00:00:00.000Z#|,
            ~S|[#2026-03-01T00:00:00Z#] < [#2026-03-01T00:00:00.000Z#]|,
            ~S|[#2026-03-01T00:00:00.000Z#] < [#2026-03-01T00:00:00Z#]|,
            ~S|{opened_on: #2026-03-01T00:00:00Z#} in [{opened_on: #2026-03-01T00:00:00.000Z#}]|,
            ~S|[#2025-12-31#] < [#2026-01-02#]|,
            ~S|[#2026-01-02#] <= [#2025-12-31#]|,
            ~S|[#2026-01-02#] >= [#2025-12-31#]|,
            ~S|[#2026-02-01T00:00:00Z#] > [#2025-12-31T00:00:00Z#]|,
            ~S|[#2026-02-01T00:00:00Z#] <= [#2025-12-31T00:00:00Z#]|,
            ~S|[[#2026-01-02#]] < [[#2025-12-31#]]|,
            ~S|[#2026-01-01#, #2026-01-02#] > [#2026-01-01#, #2025-12-31#]|,
            ~S|[#2026-01-01T00:00:00Z#, #2026-01-02#] <= [#2026-01-01T00:00:00.000Z#, #2025-12-31#]|,
            ~S|[#2026-01-01T00:00:00.000Z#, #2026-02-01T00:00:00Z#] > [#2026-01-01T00:00:00Z#, #2025-12-31T00:00:00Z#]|
          ],
          1
        ) do
    %{
      "id" => "date-member/#{at |> Integer.to_string() |> String.pad_leading(3, "0")}",
      "source" => source,
      "context" => %{}
    }
  end

# A LIST ORDERING THAT MEETS A MEMBER HOLDING THE NULL VALUE. The reference
# orders two lists by its host language's term order, which steps past two
# members holding the null value as equal members and places the null value
# after a number and before a string, a list, a map, a date and a datetime.
# Each ordering is asked under each of the four operators where it reads
# differently: two members holding the null value, leading and later, alone
# and beside other members, from literals and from the context; the null
# value against a number at the first and at a later position, either way
# round; a leading null value against a number when a later member would
# order the two lists the other way; the null value against a boolean, a
# string, a list, a map, a date, a datetime and a duration; a list that runs
# out before the other; and the top-level null value, which the reference
# does not order at all. The fields are a patron's holds and loans.
null_order_cases =
  for {{source, context}, at} <-
        Enum.with_index(
          [
            {~S|[null, 1] < [null, 2]|, %{}},
            {~S|[null, 1] > [null, 2]|, %{}},
            {~S|[null, 1] <= [null, 1]|, %{}},
            {~S|[null] >= [null]|, %{}},
            {~S|[null] < [null]|, %{}},
            {~S|[null] > [null]|, %{}},
            {~S|[null] <= [null]|, %{}},
            {~S|[null, 1] >= [null, 2]|, %{}},
            {~S|[1, null] < [1, null]|, %{}},
            {~S|[1, null] <= [1, null]|, %{}},
            {~S|[1, null, 2] < [1, null, 3]|, %{}},
            {~S|[null, null] > [null]|, %{}},
            {~S|[null] < [null, null]|, %{}},
            {~S|[null] < [1]|, %{}},
            {~S|[null] > [1]|, %{}},
            {~S|[1] < [null]|, %{}},
            {~S|[1] >= [null]|, %{}},
            {~S|[1, null] < [1, 2]|, %{}},
            {~S|[1, null] > [1, 2]|, %{}},
            {~S|[1, 2] <= [1, null]|, %{}},
            {~S|[null, 1] < [1, 2]|, %{}},
            {~S|[null, 1] > [1, 2]|, %{}},
            {~S|[1, 2] > [null, 1]|, %{}},
            {~S|[null] < [1.5]|, %{}},
            {~S|[null] < [true]|, %{}},
            {~S|[null] > [false]|, %{}},
            {~S|[null] < ["overdue"]|, %{}},
            {~S|[null] < [[1]]|, %{}},
            {~S|[null] < [[]]|, %{}},
            {~S|[null] < [{loans: 1}]|, %{}},
            {~S|[null] < [#2026-03-01#]|, %{}},
            {~S|[null] < [#2026-03-01T00:00:00Z#]|, %{}},
            {~S|[null] < [3d]|, %{}},
            {~S|[null] > []|, %{}},
            {~S|[[null], 1] < [[1], 1]|, %{}},
            {~S|[null] < [undefined]|, %{}},
            {~S|[undefined] > [null]|, %{}},
            {~S|[null] < [renewed_on]|, %{}},
            {~S|holds < loans|, %{"holds" => [nil, 1], "loans" => [nil, 2]}},
            {~S|holds >= loans|, %{"holds" => [nil], "loans" => [nil]}},
            {~S|holds > loans|, %{"holds" => [nil], "loans" => [3]}},
            {~S|null < null|, %{}},
            {~S|null <= null|, %{}},
            {~S|null < 1|, %{}}
          ],
          1
        ) do
    %{
      "id" => "null-order/#{at |> Integer.to_string() |> String.pad_leading(3, "0")}",
      "source" => source,
      "context" => context
    }
  end

authored =
  float_cases ++
    float_cast_back_cases ++
    string_cases ++
    offset_cases ++
    json_form_cases ++
    leading_sign_cases ++
    map_key_cases ++ duration_field_cases ++ integer_range_cases ++ clock_cases ++
    duration_against_map_cases ++ date_arithmetic_cases ++ member_equality_cases ++
    date_member_cases ++ null_order_cases

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
