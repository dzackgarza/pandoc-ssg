-- Normalize math for the site's single MathJax path. Ported from
-- ~/.pandoc/filters/convert_math_delimiters.lua (HTML output path): inline math
-- stays as pandoc's \( \) span; every displayed equation is wrapped in an
-- align* environment (align when it carries a \label) so display math is always
-- alignable — the required align normalization, not bare \[ \].
--
-- It also repairs the block structure display math disturbs: pandoc emits a
-- no-blank-line block that *begins* with display math as a `Plain` (which the
-- HTML writer renders WITHOUT a <p>), so the prose escapes the theme's
-- `p { font-size: 1.4rem }` rule and shrinks to the body size mid-paragraph.
-- The Div/Pandoc passes below promote those prose Plains back to Para. Tight-
-- list items live inside Bullet/Ordered/DefinitionList, which this never
-- descends into, so list tightness is preserved.

local function trim(text)
  return (text:gsub("^%s+", ""):gsub("%s+$", ""))
end

local function is_display_math(m)
  return m.mathtype == "DisplayMath"
end

local function already_alignable(text)
  return text:match("^%s*\\begin%s*{%s*align%*?%s*}") ~= nil
end

local function alignment_environment(text)
  if text:find("\\label%s*{") then
    return "align"
  end
  return "align*"
end

local function alignable_display(text)
  local content = trim(text)
  if already_alignable(content) then
    return content
  end
  local env = alignment_environment(content)
  return "\\begin{" .. env .. "}\n" .. content .. "\n\\end{" .. env .. "}"
end

function Math(m)
  if not is_display_math(m) then
    return m
  end
  return pandoc.RawInline("html", '\n<span class="math display">\n' .. alignable_display(m.text) .. "\n</span>")
end

-- Does this inline list carry a display equation? (either pandoc's own
-- DisplayMath, or the span this filter already emitted for one.)
local function has_display_math(inlines)
  for _, inl in ipairs(inlines) do
    if inl.t == "Math" and inl.mathtype == "DisplayMath" then
      return true
    end
    if inl.t == "RawInline" and inl.text:find('class="math display"', 1, true) then
      return true
    end
  end
  return false
end

-- Promote a prose `Plain` back to `Para` so it renders inside a <p>. Pandoc
-- emits a no-blank-line block that *begins* with display math as a `Plain`
-- (rendered with no <p>), dropping the prose below the p-scoped size. Keyed on
-- the block actually carrying display math, so ordinary tight-list items (which
-- never do) stay Plain and the list stays tight — and it costs only a Plain
-- visit, not a whole-document Lua pass.
function Plain(el)
  if has_display_math(el.content) then
    return pandoc.Para(el.content)
  end
  return nil
end
