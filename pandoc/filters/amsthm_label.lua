-- Prepend a real, selectable label ("Theorem.", "Definition.", …) to the very
-- start of each amsthm environment div, as actual DOM text.
--
-- This replaces a CSS ::before label, which is non-selectable (breaks
-- copy-paste) and — for loose-inline env content (a div that also contains a
-- diagram, so pandoc emits a Plain block with no <p>) — lands before the first
-- inline ELEMENT (e.g. a math span) instead of the start of the sentence.

local ENVS = {
  theorem = "Theorem",
  lemma = "Lemma",
  proposition = "Proposition",
  corollary = "Corollary",
  proof = "Proof",
  remark = "Remark",
  definition = "Definition",
  example = "Example",
  conjecture = "Conjecture",
  claim = "Claim",
  observation = "Observation",
  question = "Question",
  problem = "Problem",
  assumption = "Assumption",
  warning = "Warning",
  warnings = "Warning",
  fact = "Fact",
  exercise = "Exercise",
  note = "Note",
}

function Div(el)
  local name = ENVS[el.classes[1]]
  if not name then
    return el
  end

  local label = pandoc.Span({ pandoc.Str(name .. ".") }, pandoc.Attr("", { "thmlabel" }))
  local first = el.content[1]
  if first ~= nil and (first.t == "Para" or first.t == "Plain") then
    -- run-in: label + space at the start of the first paragraph's inlines.
    table.insert(first.content, 1, pandoc.Space())
    table.insert(first.content, 1, label)
  else
    -- no leading paragraph (e.g. the env opens with a list/diagram): label on
    -- its own leading line.
    table.insert(el.content, 1, pandoc.Plain({ label }))
  end
  return el
end
