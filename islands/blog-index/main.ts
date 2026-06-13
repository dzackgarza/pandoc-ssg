// Entry point for the blog-index island bundle. Hydrates the mount point the
// Lua filter emitted, reading the posts.json URL from its data-posts attribute.
import { mount } from "svelte";
import BlogIndex from "./BlogIndex.svelte";

let el = document.getElementById("blog-index");
if (el === null) {
  throw new Error("blog-index island: mount point #blog-index not found");
}

let postsUrl = el.dataset.posts;
if (postsUrl === undefined) {
  throw new Error("blog-index island: mount point is missing its data-posts attribute");
}

mount(BlogIndex, { target: el, props: { postsUrl } });
