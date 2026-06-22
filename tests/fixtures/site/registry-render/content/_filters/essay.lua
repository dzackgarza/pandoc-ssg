function Pandoc(doc)
  table.insert(doc.blocks, pandoc.RawBlock("html", "<p class=\"registry-filter\">filtered-by-content</p>"))
  return doc
end
