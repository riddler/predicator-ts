# The reference half of the token transcript: run inside an export of the
# reference implementation, never inside this repository.
#
#   mix run <this file> <sources file> <output directory>
#
# `scripts/reference-tokens.mjs` is what runs this, with the export as the
# working directory, and it is the only intended caller: it enumerates the
# sources from the scanner's suite, checks the export against the tag it was
# asked for, and writes what this leaves behind into `conformance/transcript/`.
# Run by hand, this reads the sources file, a JSON array of strings, and writes
# two files into the output directory and nothing else.
#
# WHAT THIS DOES. For each source it calls `Predicator.Lexer.tokenize/1` and
# records the answer. Nothing here computes an answer; the reference does.
# `Predicator.Conformance.JSON.encode_lines/1`, the reference's own canonical
# writer, writes each row as one line.
#
# WHAT A ROW CARRIES. A `tokens` row holds the source and, for each token of
# the stream the reference answered, its type, line, column and length; a
# string token also carries its quote and its exclusive end, the two members
# the reference's string token holds past its value. A `refusal` row holds the
# source and the message, position and span the reference refused it with.
# A token's value is not carried: the two implementations spell values
# differently (a date, the undefined value, the parts of a fractional duration
# number), so a value is not a thing a row can compare, and the suite asserts
# this package's values directly.
#
# WHAT HAPPENS WHEN THE REFERENCE RAISES, OR ANSWERS TEXT THAT IS NOT UTF-8.
# Neither is an answer a row can hold, so every call runs inside a rescue, and
# a raise or a message that is not valid UTF-8 is collected as a problem
# rather than ending the run: the list is walked to its end, every such source
# is reported, and the run then halts without writing a file.

[sources_path, output_dir] = System.argv()

alias Predicator.Conformance.JSON, as: CanonicalJSON

sources = sources_path |> File.read!() |> JSON.decode!()

encode_position = fn {line, column} -> %{"line" => line, "column" => column} end

encode_token = fn
  {:string, line, column, length, _value, quote_type, end_position} ->
    %{
      "type" => "string",
      "line" => line,
      "column" => column,
      "length" => length,
      "quote" => Atom.to_string(quote_type),
      "end" => encode_position.(end_position)
    }

  {type, line, column, length, _value} ->
    %{"type" => Atom.to_string(type), "line" => line, "column" => column, "length" => length}
end

attempt = fn source ->
  try do
    {:answered, Predicator.Lexer.tokenize(source)}
  rescue
    exception -> {:raised, inspect(exception.__struct__), Exception.message(exception)}
  end
end

results =
  for source <- sources do
    case attempt.(source) do
      {:answered, {:ok, tokens}} ->
        {:ok, %{"kind" => "tokens", "source" => source, "tokens" => Enum.map(tokens, encode_token)}}

      {:answered, {:error, message, line, column, {start_position, end_position}}} ->
        if String.valid?(message) do
          {:ok,
           %{
             "kind" => "refusal",
             "source" => source,
             "message" => message,
             "position" => encode_position.({line, column}),
             "span" => %{
               "start" => encode_position.(start_position),
               "end" => encode_position.(end_position)
             }
           }}
        else
          {:problem, source, "the reference refused it with a message that is not UTF-8"}
        end

      {:raised, struct_name, message} ->
        {:problem, source, "the reference raised #{struct_name}: #{message}"}
    end
  end

problems = for {:problem, source, problem} <- results, do: {source, problem}

if problems != [] do
  for {source, problem} <- problems do
    IO.puts(:stderr, "#{inspect(source)}: #{problem}")
  end

  IO.puts(
    :stderr,
    "the source list has #{length(problems)} problem(s); no transcript was written"
  )

  System.halt(1)
end

rows = for {:ok, row} <- results, do: row

File.write!(Path.join(output_dir, "tokens.json"), CanonicalJSON.encode_lines(rows))

counts = %{
  "tokens" => Enum.count(rows, &(&1["kind"] == "tokens")),
  "refusal" => Enum.count(rows, &(&1["kind"] == "refusal")),
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
