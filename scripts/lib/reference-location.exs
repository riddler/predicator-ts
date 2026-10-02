# The reference half of the location transcript: run inside an export of the
# reference implementation, never inside this repository.
#
#   mix run <this file> <location sources file> <output directory>
#
# `scripts/reference-location.mjs` is what runs this, with the export as the
# working directory, and it is the only intended caller: it checks the export
# against the tag it was asked for and writes what this leaves behind into
# `conformance/transcript/`. Run by hand, this reads the location sources
# file, a JSON array of the entries `scripts/lib/location-sources.mjs` lists,
# and writes two files into the output directory and nothing else.
#
# WHAT THIS DOES. For each entry it decodes the context, the path and the value
# from their tagged-encoding text with `Predicator.Conformance.Values.from_json/1`,
# calls the one reference function the entry names -
# `Predicator.context_location/3`, `Predicator.ContextLocation.put/3` or
# `Predicator.context_assign/4` - and records what it answered. Nothing here
# computes an answer; the reference does. The reference's own canonical
# writer, `Predicator.Conformance.JSON.encode_lines/1`, writes each row as one
# line, and `Predicator.Conformance.Values.to_json/1` encodes every value in the
# tagged encoding the vendored corpus carries, so the absence reads as the
# tagged object it is there, and an integral float keeps its decimal point.
#
# WHY NOT THE CORPUS GENERATOR. The generator runs a source to a value; none of
# these three functions is reachable through it. This file calls the entry
# points directly, which is the whole of what it calls.
#
# WHAT A ROW HOLDS. Every row carries the entry's `id` and `call`, the inputs
# as the reference was handed them (`context`, then `source` or `path`, then
# `value` where the call writes), the kind of `answer`, and `inspect`: the
# reference's whole answer as `inspect/2` prints it, with no limit, so a
# reader can see the answer in the reference's own terms beside the encoded
# one. The rest depends on the answer.
#
#   - `path`: `result` is the resolved path, a list of string and integer
#     segments.
#   - `context`: `result` is the answered context. JSON keys are strings, and
#     the reference's map can hold an integer or a float key, which
#     `to_json/1` writes as its text; so `non_string_keys` lists every such
#     key with the path of the map that holds it (`at`), the key itself
#     encoded as a value, so a reader can tell the key `0` from the key "0".
#     It is an empty list when the context holds none.
#   - `location_error`: `error` carries the error's `type` and `message` as
#     the reference wrote them, and its `details` map under the reference's own
#     key names, each value encoded as a value. Two detail values are syntax
#     trees, which have no place in the value domain; each is written as its
#     `inspect/2` text instead, and `details_as_text` names the keys written
#     that way.
#   - `parse_error`: `error` carries the message, the position and the span,
#     as the compile transcript writes a refusal's.
#
# WHAT HAPPENS WHEN THE REFERENCE RAISES, OR ANSWERS OTHERWISE. Every call runs
# inside a rescue. A raise, an answer of another kind than the entry was
# authored to draw, and a value the encoding cannot carry are each collected as
# a problem; the list is walked to its end, every problem is reported with the
# entry's id, and the run then halts without writing a file.

[location_sources_path, output_dir] = System.argv()

location_sources = location_sources_path |> File.read!() |> JSON.decode!()

alias Predicator.ContextLocation
alias Predicator.Conformance.JSON, as: CanonicalJSON
alias Predicator.Conformance.Values
alias Predicator.Errors.LocationError
alias Predicator.Errors.ParseError

decode = fn text ->
  case Values.from_json(JSON.decode!(text)) do
    {:ok, value} -> value
    {:error, reason} -> raise ArgumentError, "#{inspect(text)} does not decode: #{inspect(reason)}"
  end
end

encode = fn value ->
  case Values.to_json(value) do
    {:ok, encoded} -> encoded
    {:error, reason} -> raise ArgumentError, "#{inspect(value)} does not encode: #{inspect(reason)}"
  end
end

encode_position = fn {line, column} -> %{"line" => line, "column" => column} end

encode_span = fn {start_position, end_position} ->
  %{"start" => encode_position.(start_position), "end" => encode_position.(end_position)}
end

# Every key of a map in the answered context that is not a string, with the
# path of the map that holds it. The path's own non-string segments are
# encoded as values, as the key is.
non_string_keys = fn non_string_keys, value, at ->
  cond do
    is_map(value) and not is_struct(value) ->
      Enum.flat_map(value, fn {key, member} ->
        own =
          if is_binary(key), do: [], else: [%{"at" => Enum.reverse(at), "key" => encode.(key)}]

        own ++ non_string_keys.(non_string_keys, member, [encode.(key) | at])
      end)

    is_list(value) ->
      value
      |> Enum.with_index()
      |> Enum.flat_map(fn {member, index} -> non_string_keys.(non_string_keys, member, [index | at]) end)

    true ->
      []
  end
end

encode_details = fn details ->
  details
  |> Enum.sort_by(fn {key, _value} -> Atom.to_string(key) end)
  |> Enum.reduce({%{}, []}, fn {key, value}, {encoded, as_text} ->
    name = Atom.to_string(key)

    case Values.to_json(value) do
      {:ok, member} -> {Map.put(encoded, name, member), as_text}
      {:error, _reason} -> {Map.put(encoded, name, inspect(value, limit: :infinity)), as_text ++ [name]}
    end
  end)
end

call = fn entry ->
  context = decode.(entry["context"])

  case entry["call"] do
    "context_location" ->
      {%{"context" => encode.(context), "source" => entry["source"]},
       Predicator.context_location(entry["source"], context)}

    "put" ->
      path = decode.(entry["path"])
      value = decode.(entry["value"])

      {%{"context" => encode.(context), "path" => encode.(path), "value" => encode.(value)},
       ContextLocation.put(context, path, value)}

    "context_assign" ->
      value = decode.(entry["value"])

      {%{"context" => encode.(context), "source" => entry["source"], "value" => encode.(value)},
       Predicator.context_assign(context, entry["source"], value)}
  end
end

kind_of = fn
  "context_location", {:ok, _path} -> "path"
  _call, {:ok, _context} -> "context"
  _call, {:error, %LocationError{}} -> "location_error"
  _call, {:error, %ParseError{}} -> "parse_error"
  _call, _other -> "unrecognized"
end

answer_fields = fn
  "path", {:ok, path} ->
    %{"result" => encode.(path)}

  "context", {:ok, context} ->
    keys = non_string_keys.(non_string_keys, context, []) |> Enum.sort_by(&inspect/1)
    %{"result" => encode.(context), "non_string_keys" => keys}

  "location_error", {:error, %LocationError{} = error} ->
    {details, as_text} = encode_details.(error.details)

    %{
      "error" => %{
        "type" => Atom.to_string(error.type),
        "message" => error.message,
        "details" => details
      },
      "details_as_text" => as_text
    }

  "parse_error", {:error, %ParseError{} = error} ->
    %{
      "error" => %{
        "message" => error.message,
        "position" => encode_position.(error.position),
        "span" => encode_span.(error.span)
      }
    }
end

results =
  for entry <- location_sources do
    id = entry["id"]

    try do
      {inputs, answer} = call.(entry)
      kind = kind_of.(entry["call"], answer)

      if kind == entry["answer"] do
        row =
          inputs
          |> Map.merge(answer_fields.(kind, answer))
          |> Map.merge(%{
            "id" => id,
            "call" => entry["call"],
            "answer" => kind,
            "inspect" => inspect(answer, limit: :infinity, printable_limit: :infinity)
          })

        {:ok, row}
      else
        {:problem, id,
         "authored to draw #{entry["answer"]}, the reference answered #{kind}: #{inspect(answer, limit: :infinity)}"}
      end
    rescue
      exception -> {:problem, id, "the run raised #{inspect(exception.__struct__)}: #{Exception.message(exception)}"}
    end
  end

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

File.write!(Path.join(output_dir, "location.json"), CanonicalJSON.encode_lines(rows))

counts =
  rows
  |> Enum.frequencies_by(& &1["answer"])
  |> Map.merge(Enum.frequencies_by(rows, & &1["call"]))
  |> Map.put("rows", length(rows))

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
