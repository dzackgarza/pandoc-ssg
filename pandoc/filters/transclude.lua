-- Transclusion (O10).
--
-- Expands ::: {.include path="..."} into the pandoc-parsed blocks of the
-- referenced file, resolved relative to the including file. A path that
-- resolves outside the content root aborts the build (pandoc exits nonzero),
-- as does a missing file or an empty path attribute.
--
-- Runs before components.lua so a transcluded file's own components still
-- expand in the later pass.

local content_root = nil

local function including_dir()
  local inputs = PANDOC_STATE.input_files
  if inputs == nil or #inputs == 0 then
    error("transclude: no input file in pandoc state")
  end
  return pandoc.path.directory(inputs[1])
end

local function within_root(target)
  if content_root == nil or content_root == "" then
    return true
  end
  local root = pandoc.path.normalize(content_root)
  return target == root or target:sub(1, #root + 1) == (root .. "/")
end

local function expand_include(el)
  local is_include = false
  for _, c in ipairs(el.classes) do
    if c == "include" then
      is_include = true
      break
    end
  end
  if not is_include then
    return nil
  end

  local rel = el.attributes.path
  if rel == nil or rel == "" then
    error("transclude: .include requires a non-empty path attribute")
  end

  local target = pandoc.path.normalize(pandoc.path.join({ including_dir(), rel }))
  if not within_root(target) then
    error("transclude: path escapes content root: " .. rel)
  end

  local fh = io.open(target, "r")
  if fh == nil then
    error("transclude: cannot open included file: " .. rel)
  end
  local raw = fh:read("a")
  fh:close()

  -- Parse the included file with the same math delimiters as the page reader
  -- (defaults/*.yaml `from:`). Default "markdown" already enables tex_math_dollars
  -- and fenced_divs; add tex_math_single_backslash so included notes authored with
  -- \[...\] / \(...\) parse as math instead of mangling into literal prose.
  return pandoc.read(raw, "markdown+tex_math_single_backslash").blocks
end

function Pandoc(doc)
  local cr = doc.meta.content_root
  if cr ~= nil then
    content_root = pandoc.utils.stringify(cr)
  end
  return doc:walk({ Div = expand_include })
end
