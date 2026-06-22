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
local registry = { handlers = {}, islands = {}, contentRoot = "" }
local module_cache = {}

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

local function load_components_registry(meta)
  local path_meta = meta.components_registry_path
  if path_meta == nil then
    error("components: missing components_registry_path metadata")
  end
  local path = pandoc.utils.stringify(path_meta)
  if path == "" then
    error("components: empty components_registry_path metadata")
  end
  local fh = io.open(path, "r")
  if fh == nil then
    error("components: cannot open registry sidecar at " .. path)
  end
  local raw = fh:read("a")
  fh:close()
  registry = pandoc.json.decode(raw)
  registry.handlers = registry.handlers or {}
  registry.islands = registry.islands or {}
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

-- Restrained bibliographic list for the publications page (O22). Author-ordered;
-- each entry's `title` (inline markdown) is the defining field and a missing one
-- aborts the build. The `paper-meta` line joins the present fields among authors,
-- year, venue, and the arXiv link with a middot (absent fields skipped — no
-- doubled separators). A bare arXiv id becomes an abs URL; a full URL is linked
-- verbatim. The `abstract` (block markdown) becomes a native <details>, emitted
-- only when present. Class names follow AESTHETIC-GUIDELINES §6 (no cards).
local function render_papers(key)
  local papers = items[key]
  if papers == nil then
    error("component papers: unknown items key '" .. tostring(key) .. "'")
  end
  local parts = { '<ul class="papers">' }
  for _, p in ipairs(papers) do
    local title = p.title or ""
    if title == "" then
      error("component papers: entry under '" .. tostring(key) .. "' is missing a title")
    end
    parts[#parts + 1] = '<li class="paper">'
    parts[#parts + 1] = '<span class="paper-title">' .. md_inline_html(title) .. "</span>"

    local meta = {}
    if p.authors and p.authors ~= "" then
      meta[#meta + 1] = esc_text(p.authors)
    end
    if p.year ~= nil then
      -- JSON decodes an integral year as a float (2025.0); render it as 2025.
      local y = p.year
      if math.type(y) == "float" and y == math.floor(y) then
        y = math.tointeger(y)
      end
      local ys = tostring(y)
      if ys ~= "" then
        meta[#meta + 1] = esc_text(ys)
      end
    end
    if p.venue and p.venue ~= "" then
      meta[#meta + 1] = esc_text(p.venue)
    end
    local arxiv = p.arxiv
    if arxiv ~= nil and arxiv ~= "" then
      local href, label
      if arxiv:find("://", 1, true) then
        href, label = arxiv, "arXiv"
      else
        href, label = "https://arxiv.org/abs/" .. arxiv, "arXiv:" .. arxiv
      end
      meta[#meta + 1] = '<a class="paper-arxiv" href="' .. esc_attr(href) .. '">' .. esc_text(label) .. "</a>"
    end
    if #meta > 0 then
      parts[#parts + 1] = '<div class="paper-meta">' .. table.concat(meta, " · ") .. "</div>"
    end

    local abstract = p.abstract or ""
    if abstract ~= "" then
      parts[#parts + 1] = '<details class="paper-abstract">'
      parts[#parts + 1] = '<summary class="abstract-toggle">Abstract</summary>'
      parts[#parts + 1] = '<div class="abstract">' .. md_block_html(abstract) .. "</div>"
      parts[#parts + 1] = "</details>"
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

-- Static media grid (O23, supersedes gallery). Author-ordered figures; each item's
-- `type` is "image" (src + optional href/alt) or "video" (reuses the O17 youtube
-- embed via provider+id). Optional `tags` are emitted only as a space-joined
-- `data-tags` attribute — carried as data, never an interactive filter. An optional
-- `caption` renders as inline markdown. Unknown/missing item type aborts the build.
local function render_media_gallery(key)
  local media = items[key]
  if media == nil then
    error("component media-gallery: unknown items key '" .. tostring(key) .. "'")
  end
  local parts = { '<div class="media-gallery">' }
  for _, item in ipairs(media) do
    local data_tags = ""
    if type(item.tags) == "table" and #item.tags > 0 then
      data_tags = ' data-tags="' .. esc_attr(table.concat(item.tags, " ")) .. '"'
    end
    parts[#parts + 1] = '<figure class="media-gallery__item"' .. data_tags .. ">"

    local mtype = item.type
    if mtype == "image" then
      local src = item.src or ""
      local alt = item.alt or ""
      local href = item.href or ""
      local img = '<img class="media-gallery__image" src="' .. esc_attr(src) .. '" alt="' .. esc_attr(alt) .. '">'
      if href ~= "" then
        parts[#parts + 1] = '<a class="media-gallery__link" href="' .. esc_attr(href) .. '">' .. img .. "</a>"
      else
        parts[#parts + 1] = img
      end
    elseif mtype == "video" then
      parts[#parts + 1] = render_video(item.provider, item.id)
    else
      error("component media-gallery: unknown item type '" .. tostring(mtype) .. "'")
    end

    local caption = item.caption or ""
    if caption ~= "" then
      parts[#parts + 1] = '<figcaption class="media-gallery__caption">' .. md_inline_html(caption) .. "</figcaption>"
    end
    parts[#parts + 1] = "</figure>"
  end
  parts[#parts + 1] = "</div>"
  return table.concat(parts, "\n")
end

-- Curated external link list (O24). `items[key]` is a group object
-- {title?, description?, links: [{label, href, note?}]}. Restrained titled list
-- (no cards). A link with an empty/missing href aborts the build (fail loud — a
-- link group's purpose is working links). label/description/note are inline md.
local function render_link_group(key)
  local group = items[key]
  if group == nil then
    error("component link-group: unknown items key '" .. tostring(key) .. "'")
  end
  local parts = { '<section class="link-group">' }
  local title = group.title or ""
  if title ~= "" then
    parts[#parts + 1] = '<h2 class="link-group__title">' .. md_inline_html(title) .. "</h2>"
  end
  local description = group.description or ""
  if description ~= "" then
    parts[#parts + 1] = '<p class="link-group__description">' .. md_inline_html(description) .. "</p>"
  end
  parts[#parts + 1] = '<ul class="link-group__links">'
  for _, link in ipairs(group.links or {}) do
    local href = link.href or ""
    if href == "" then
      error("component link-group: a link under '" .. tostring(key) .. "' is missing an href")
    end
    local label = link.label or ""
    local note = link.note or ""
    local li = '<li class="link-group__link"><a href="' .. esc_attr(href) .. '">' .. md_inline_html(label) .. "</a>"
    if note ~= "" then
      li = li .. ' — <span class="link-group__note">' .. md_inline_html(note) .. "</span>"
    end
    parts[#parts + 1] = li .. "</li>"
  end
  parts[#parts + 1] = "</ul>"
  parts[#parts + 1] = "</section>"
  return table.concat(parts, "\n")
end

local function site_path(path)
  if path == nil or path == "" then
    return ""
  end
  if path:sub(1, 1) == "/" then
    return path
  end
  return "/" .. path
end

local function data_output(template, key)
  if template == nil then
    return ""
  end
  return template:gsub("{key}", key or "")
end

local function island_for_component(component_type, handler)
  local island_name = handler.island
  if island_name == nil or island_name == "" then
    error("component " .. tostring(component_type) .. ": registry handler does not declare an island")
  end
  local island = registry.islands[island_name]
  if island == nil then
    error("component " .. tostring(component_type) .. ": island '" .. tostring(island_name) .. "' is not registered")
  end
  return island_name, island
end

local function render_collection(attrs, handler)
  local key = attrs.items
  if key == nil or key == "" then
    error("component collection: missing required items=\"KEY\" attribute")
  end
  local island_name, island = island_for_component("collection", handler)
  local mount = island.mount or "collection"
  local data_path = site_path(data_output(island.dataOutput, key))
  return '<div class="'
    .. esc_attr(mount)
    .. '" data-ssg-island="'
    .. esc_attr(island_name)
    .. '" data-ssg-data-key="'
    .. esc_attr(key)
    .. '" data-collection="'
    .. esc_attr(data_path)
    .. '"></div>\n'
    .. '<script type="module" src="'
    .. esc_attr(site_path(island.output))
    .. '"></script>'
end

local function render_blog_index(handler)
  local island_name, island = island_for_component("blog-index", handler)
  local mount = island.mount or "blog-index"
  return '<div id="'
    .. esc_attr(mount)
    .. '" data-ssg-island="'
    .. esc_attr(island_name)
    .. '" data-posts="'
    .. esc_attr(site_path(island.dataOutput))
    .. '"></div>\n'
    .. '<script type="module" src="'
    .. esc_attr(site_path(island.output))
    .. '"></script>'
end

local builtins = {
  ["feature-row"] = function(attrs)
    return render_feature_row(attrs.items)
  end,
  ["media-gallery"] = function(attrs)
    return render_media_gallery(attrs.items)
  end,
  ["link-group"] = function(attrs)
    return render_link_group(attrs.items)
  end,
  ["timeline"] = function(attrs)
    return render_timeline(attrs.items)
  end,
  ["papers"] = function(attrs)
    return render_papers(attrs.items)
  end,
  ["video"] = function(attrs)
    return render_video(attrs.provider, attrs.id)
  end,
  ["collection"] = render_collection,
  ["blog-index"] = function(_attrs, handler)
    return render_blog_index(handler)
  end,
}

local function component_attrs(el)
  local attrs = {}
  for key, value in pairs(el.attributes) do
    attrs[key] = value
  end
  if el.identifier ~= nil and el.identifier ~= "" then
    attrs.id = el.identifier
  end
  return attrs
end

local function render_custom(handler, attrs)
  local path = handler.module
  if path == nil or path == "" then
    error("component handler " .. tostring(handler.handler) .. ": missing module path")
  end
  local mod = module_cache[path]
  if mod == nil then
    mod = dofile(path)
    module_cache[path] = mod
  end
  local render = mod
  if type(mod) == "table" then
    render = mod.render
  end
  if type(render) ~= "function" then
    error("component handler " .. tostring(handler.handler) .. ": module must return a function or table.render")
  end
  local result = render(attrs, items, registry.contentRoot, registry)
  if type(result) == "string" then
    return result
  end
  if type(result) == "table" and type(result.html) == "string" then
    return result.html
  end
  error("component handler " .. tostring(handler.handler) .. ": render result must be HTML string")
end

local function render_component(component_type, handler, attrs)
  if handler.module ~= nil then
    return render_custom(handler, attrs)
  end
  local renderer = builtins[handler.handler]
  if renderer == nil then
    error("component " .. tostring(component_type) .. ": unknown built-in handler '" .. tostring(handler.handler) .. "'")
  end
  return renderer(attrs, handler)
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
  local handler = registry.handlers[ctype]
  if handler == nil then
    error("unknown component type: " .. tostring(ctype))
  end
  return pandoc.RawBlock("html", render_component(ctype, handler, component_attrs(el)))
end

-- Drive the whole pass from Pandoc() so items are loaded before any Div is
-- expanded (deterministic ordering, independent of filter-traversal rules).
function Pandoc(doc)
  load_items(doc.meta)
  load_components_registry(doc.meta)
  return doc:walk({ Div = expand_div })
end
