-- Data-backed fenced-div components.
--
-- Expands placeholders such as
--   ::: {.component type="feature-row" items="KEY"}
--   :::
-- into HTML built from content/_data/items.yaml. The kernel serializes that
-- data to a JSON sidecar and passes its path via the `items_path` metadata
-- field; this filter decodes it and renders the named component. An unknown
-- component type or a missing data key aborts the build (pandoc exits nonzero).

local items = {}

local function load_items(meta)
  local path_meta = meta.items_path
  if path_meta == nil then
    return
  end
  local path = pandoc.utils.stringify(path_meta)
  if path == "" then
    return
  end
  local fh = io.open(path, "r")
  if fh == nil then
    error("components: cannot open items sidecar at " .. path)
  end
  local raw = fh:read("a")
  fh:close()
  items = pandoc.json.decode(raw)
end

local function esc_text(s)
  return (s:gsub("&", "&amp;"):gsub("<", "&lt;"):gsub(">", "&gt;"))
end

local function esc_attr(s)
  return (esc_text(s):gsub('"', "&quot;"))
end

-- Render a markdown string to a block-level HTML fragment.
local function md_block_html(md)
  return pandoc.write(pandoc.read(md, "markdown"), "html")
end

-- Render a markdown string to an inline HTML fragment (no <p> wrapper), so
-- card titles may carry inline math such as `Category $\OO$`.
local function md_inline_html(md)
  local blocks = pandoc.read(md, "markdown").blocks
  if #blocks == 0 then
    return ""
  end
  local first = blocks[1]
  local inlines = first.content or {}
  return pandoc.write(pandoc.Pandoc({ pandoc.Plain(inlines) }), "html")
end

local function render_feature_row(key)
  local cards = items[key]
  if cards == nil then
    error("component feature-row: unknown items key '" .. tostring(key) .. "'")
  end
  local parts = { '<div class="feature-row">' }
  for _, card in ipairs(cards) do
    local title = card.title or ""
    local img = card.image_path or ""
    local alt = card.alt or ""
    local url = card.url or ""
    local excerpt = card.excerpt or ""
    parts[#parts + 1] = '<div class="feature-card">'
    if img ~= "" then
      parts[#parts + 1] = '<img class="feature-card__image" src="'
        .. esc_attr(img)
        .. '" alt="'
        .. esc_attr(alt)
        .. '">'
    end
    parts[#parts + 1] = '<h3 class="feature-card__title">' .. md_inline_html(title) .. "</h3>"
    if excerpt ~= "" then
      parts[#parts + 1] = '<div class="feature-card__excerpt">' .. md_block_html(excerpt) .. "</div>"
    end
    if url ~= "" then
      parts[#parts + 1] = '<a class="feature-card__link" href="' .. esc_attr(url) .. '">Read more</a>'
    end
    parts[#parts + 1] = "</div>"
  end
  parts[#parts + 1] = "</div>"
  return table.concat(parts, "\n")
end

local function expand_div(el)
  local is_component = false
  for _, c in ipairs(el.classes) do
    if c == "component" then
      is_component = true
      break
    end
  end
  if not is_component then
    return nil
  end

  local ctype = el.attributes.type
  if ctype == "feature-row" then
    return pandoc.RawBlock("html", render_feature_row(el.attributes.items))
  end
  error("unknown component type: " .. tostring(ctype))
end

-- Drive the whole pass from Pandoc() so items are loaded before any Div is
-- expanded (deterministic ordering, independent of filter-traversal rules).
function Pandoc(doc)
  load_items(doc.meta)
  return doc:walk({ Div = expand_div })
end
