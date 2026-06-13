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

local function render_gallery(key)
  local images = items[key]
  if images == nil then
    error("component gallery: unknown items key '" .. tostring(key) .. "'")
  end
  local parts = { '<div class="gallery">' }
  for _, image in ipairs(images) do
    local src = image.image_path or image.url or ""
    local href = image.url or image.image_path or ""
    local alt = image.alt or ""
    local title = image.title or ""
    parts[#parts + 1] = '<figure class="gallery__item">'
    local img = '<img class="gallery__image" src="' .. esc_attr(src) .. '" alt="' .. esc_attr(alt) .. '">'
    if href ~= "" then
      parts[#parts + 1] = '<a class="gallery__link" href="' .. esc_attr(href) .. '">' .. img .. "</a>"
    else
      parts[#parts + 1] = img
    end
    if title ~= "" then
      parts[#parts + 1] = '<figcaption class="gallery__caption">' .. md_inline_html(title) .. "</figcaption>"
    end
    parts[#parts + 1] = "</figure>"
  end
  parts[#parts + 1] = "</div>"
  return table.concat(parts, "\n")
end

-- Restrained dated list for teaching/activities (O21). Author-ordered (no
-- re-sort); each entry's `date` is the defining field (plain text) and a missing
-- date aborts the build. `title` and optional `detail` render as inline markdown.
local function render_timeline(key)
  local entries = items[key]
  if entries == nil then
    error("component timeline: unknown items key '" .. tostring(key) .. "'")
  end
  local parts = { '<ul class="timeline">' }
  for _, entry in ipairs(entries) do
    local date = entry.date or ""
    if date == "" then
      error("component timeline: entry under '" .. tostring(key) .. "' is missing a date")
    end
    local title = entry.title or ""
    local detail = entry.detail or ""
    parts[#parts + 1] = '<li class="timeline__entry">'
    parts[#parts + 1] = '<span class="timeline__date">' .. esc_text(date) .. "</span>"
    parts[#parts + 1] = '<span class="timeline__title">' .. md_inline_html(title) .. "</span>"
    if detail ~= "" then
      parts[#parts + 1] = '<span class="timeline__detail">' .. md_inline_html(detail) .. "</span>"
    end
    parts[#parts + 1] = "</li>"
  end
  parts[#parts + 1] = "</ul>"
  return table.concat(parts, "\n")
end

-- Embed providers (O17): provider name -> iframe src builder. Unknown providers
-- and missing ids abort the build (fail loud).
local function render_video(provider, id)
  if id == nil or id == "" then
    error("component video: missing required 'id' attribute")
  end
  local src
  if provider == "youtube" then
    src = "https://www.youtube.com/embed/" .. id
  else
    error("component video: unknown provider '" .. tostring(provider) .. "'")
  end
  return '<div class="responsive-embed">'
    .. '<iframe src="'
    .. esc_attr(src)
    .. '" frameborder="0" allowfullscreen></iframe>'
    .. "</div>"
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
  if ctype == "gallery" then
    return pandoc.RawBlock("html", render_gallery(el.attributes.items))
  end
  if ctype == "timeline" then
    return pandoc.RawBlock("html", render_timeline(el.attributes.items))
  end
  if ctype == "video" then
    -- pandoc maps `id="x"` to the element identifier, not attributes.id
    return pandoc.RawBlock("html", render_video(el.attributes.provider, el.identifier))
  end
  if ctype == "collection" then
    -- Interactive filterable collection island (O20): mount + module script.
    -- The client fetches the per-key JSON the build emitted from items.yaml.
    local key = el.attributes.items
    if key == nil or key == "" then
      error("component collection: missing required items=\"KEY\" attribute")
    end
    return pandoc.RawBlock(
      "html",
      '<div class="collection" data-collection="/_collections/' .. key .. '.json"></div>\n'
        .. '<script type="module" src="/assets/islands/collection.js"></script>'
    )
  end
  if ctype == "blog-index" then
    -- Interactive island (O16): emit only the hydration mount + module script.
    -- The build emits blog/posts.json and bundles the Svelte island; the
    -- client fetches the data-posts URL and renders the filterable list.
    return pandoc.RawBlock(
      "html",
      '<div id="blog-index" data-posts="/blog/posts.json"></div>\n'
        .. '<script type="module" src="/assets/islands/blog-index.js"></script>'
    )
  end
  error("unknown component type: " .. tostring(ctype))
end

-- Drive the whole pass from Pandoc() so items are loaded before any Div is
-- expanded (deterministic ordering, independent of filter-traversal rules).
function Pandoc(doc)
  load_items(doc.meta)
  return doc:walk({ Div = expand_div })
end
