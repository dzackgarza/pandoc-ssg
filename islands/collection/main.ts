// Entry point for the collection island bundle. Hydrates the mount point the
// Lua filter emitted, reading the per-key items JSON URL from data-collection.
import { mount } from "svelte";
import Collection from "./Collection.svelte";

let el = document.querySelector<HTMLElement>(".collection");
if (!el) {
  throw new Error("collection island: no .collection mount point found");
}

let dataUrl = el.dataset.collection;
if (!dataUrl) {
  throw new Error("collection island: mount point is missing its data-collection attribute");
}

mount(Collection, { target: el, props: { dataUrl } });
