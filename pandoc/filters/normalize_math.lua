-- Normalize math for the site's single MathJax path. Ported from
-- ~/.pandoc/filters/convert_math_delimiters.lua (HTML output path): inline math
-- stays as pandoc's \( \) span; every displayed equation is wrapped in an
-- align* environment (align when it carries a \label) so display math is always
-- alignable — the required align normalization, not bare \[ \].

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
