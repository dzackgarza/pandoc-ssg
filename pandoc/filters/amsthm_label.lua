-- Prepend a real, selectable, NUMBERED label ("Theorem 1.2.", "Definition
-- 1.1.", …) to the very start of each amsthm environment div, as actual DOM
-- text.
--
-- Labelling: a real <span class="thmlabel"> injected at the start beats a CSS
-- ::before label, which is non-selectable (breaks copy-paste) and — for
-- loose-inline env content (a div that also contains a diagram, so pandoc emits
-- a Plain block with no <p>) — lands before the first inline ELEMENT (e.g. a
-- math span) instead of the start of the sentence.
--
-- Numbering: section-scoped, like amsthm's \numberwithin{theorem}{section}. The
-- "section" is the shallowest heading level present in the body (the post title
-- is frontmatter, never a body Header, so every body heading is a real
-- section/subsection). Envs number "<section>.<counter>"; the counter resets at
-- each section heading. `proof` is unnumbered (amsthm convention).

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

-- Envs that carry no number (amsthm numbers a proof by its statement, not the
-- proof block itself).
local UNNUMBERED = {
  proof = true,
}

-- Inject `label` (a Span) at the very start of an env div's content.
local function inject_label(el, label)
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
end

function Pandoc(doc)
  -- Pass 1: the section level is the shallowest body heading level.
  local section_level = nil
  doc:walk({
    Header = function(h)
      if section_level == nil or h.level < section_level then
        section_level = h.level
      end
    end,
  })

  -- Pass 2: number + label, in document order so the section/counter state is
  -- correct when each env is reached.
  local section = 0
  local counter = 0
  return doc:walk({
    Header = function(h)
      if section_level ~= nil and h.level == section_level then
        section = section + 1
        counter = 0
      end
      return h
    end,
    Div = function(el)
      local name = ENVS[el.classes[1]]
      if not name then
        return el
      end

      local text
      if UNNUMBERED[el.classes[1]] then
        text = name .. "."
      else
        counter = counter + 1
        if section >= 1 then
          text = name .. " " .. section .. "." .. counter .. "."
        else
          -- envs before any section heading: flat sequential number.
          text = name .. " " .. counter .. "."
        end
      end

      local label = pandoc.Span({ pandoc.Str(text) }, pandoc.Attr("", { "thmlabel" }))
      inject_label(el, label)
      return el
    end,
  })
end
