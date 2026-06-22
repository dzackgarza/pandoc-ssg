return {
  render = function(attrs, items, content_root, registry)
    local key = attrs.items
    local first = items[key][1].title
    return '<aside class="callout" data-root="' .. content_root .. '" data-handler="' .. registry.handlers.callout.handler .. '">'
      .. '<strong>'
      .. attrs.title
      .. '</strong><span>'
      .. first
      .. '</span></aside>'
  end,
}
