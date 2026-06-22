return {
  render = function(attrs, _items, _content_root, registry)
    local handler = registry.handlers[attrs.type]
    local island = registry.islands[handler.island]
    local key = attrs.items
    local data_path = island.dataOutput:gsub("{key}", key)
    return '<div class="'
      .. island.mount
      .. '" data-ssg-island="'
      .. handler.island
      .. '" data-ssg-data-key="'
      .. key
      .. '" data-mini="/'
      .. data_path
      .. '"></div>\n<script type="module" src="/'
      .. island.output
      .. '"></script>'
  end,
}
