// Entry point for the collection island bundle. Hydrates the mount point the
// Lua filter emitted, reading the per-key items JSON URL from data-collection.
import { mount } from "svelte";
import Collection from "./Collection.svelte";

let el = document.querySelector(".collection");
if (el === null) {
  throw new Error("collection island: no .collection mount point found");
}

let dataUrl = (el as HTMLElement).dataset.collection;
if (dataUrl === undefined) {
  throw new Error("collection island: mount point is missing its data-collection attribute");
}

mount(Collection, { target: el, props: { dataUrl } });
