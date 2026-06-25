<script lang="ts">
  import { tick } from "svelte";
  import { typesetMath } from "../lib/mathjax";

  // A filterable collection rendered as a quiet list (NOT cards): the Notes
  // index that folds Writing + Talks. Search + category facet + tag facet,
  // restrained per AESTHETIC-GUIDELINES (no shadows/badges/tag-pills/avatars).
  interface Item {
    title: string;
    category: string;
    description: string;
    links: { label: string; href: string }[];
    tags: string[];
    image?: string;
    alt?: string;
    // Optional per-item media (folds the Talks page in): a slide gallery and/or
    // a single video embed. Rendered with the same .media-gallery /
    // .responsive-embed classes the theme styles for the Lua components.
    images?: { src: string; alt?: string; href?: string }[];
    video?: { provider: string; id: string };
  }

  // YouTube is the one supported provider (OSOT with the O17 video component).
  function embedSrc(video: { provider: string; id: string }): string {
    return `https://www.youtube.com/embed/${video.id}`;
  }

  let { dataUrl }: { dataUrl: string } = $props();

  let items = $state<Item[]>([]);
  let loaded = $state(false);
  let query = $state("");
  let activeCategory = $state<string | null>(null);
  let activeTag = $state<string | null>(null);

  $effect(() => {
    // No catch: a failed fetch rejects and surfaces as a page-error in verify.
    fetch(dataUrl)
      .then((r) => r.json())
      .then((data: Item[]) => {
        items = data;
        loaded = true;
      });
  });

  let categories = $derived([...new Set(items.map((i) => i.category).filter((c) => c))].sort());
  let allTags = $derived([...new Set(items.flatMap((i) => (i.tags === undefined ? [] : i.tags)))].sort());

  let filtered = $derived(
    items.filter((i) => {
      let tags = i.tags === undefined ? [] : i.tags;
      let matchesCategory = activeCategory === null || i.category === activeCategory;
      let matchesTag = activeTag === null || tags.includes(activeTag);
      let hay = `${i.title} ${i.description}`.toLowerCase();
      let matchesQuery = query === "" || hay.includes(query.toLowerCase());
      return matchesCategory && matchesTag && matchesQuery;
    }),
  );

  let listEl: HTMLElement | undefined = $state();

  // Item titles/descriptions can contain math; the list renders client-side
  // after MathJax's startup pass, so re-typeset it with the page's MathJax
  // whenever the rendered set changes (hydration, search, facet clicks).
  $effect(() => {
    filtered;
    if (!loaded || listEl === undefined) {
      return;
    }
    let el = listEl;
    tick().then(() => typesetMath(el, 10000));
  });
</script>

<div class="collection__controls">
  <input
    class="collection__search"
    type="search"
    placeholder="Search…"
    aria-label="Search the collection"
    bind:value={query}
  />
  {#if categories.length > 0}
    <div class="collection__categories" role="group" aria-label="Filter by category">
      <button
        type="button"
        class="collection__category"
        class:is-active={activeCategory === null}
        onclick={() => (activeCategory = null)}
      >
        All
      </button>
      {#each categories as category}
        <button
          type="button"
          class="collection__category"
          class:is-active={activeCategory === category}
          onclick={() => (activeCategory = category)}
        >
          {category}
        </button>
      {/each}
    </div>
  {/if}
  {#if allTags.length > 0}
    <div class="collection__tags" role="group" aria-label="Filter by tag">
      <button
        type="button"
        class="collection__tag"
        class:is-active={activeTag === null}
        onclick={() => (activeTag = null)}
      >
        All tags
      </button>
      {#each allTags as tag}
        <button
          type="button"
          class="collection__tag"
          class:is-active={activeTag === tag}
          onclick={() => (activeTag = tag)}
        >
          {tag}
        </button>
      {/each}
    </div>
  {/if}
</div>

{#if !loaded}
  <p class="collection__status">Loading…</p>
{:else}
  <ul class="collection__list" bind:this={listEl}>
    {#each filtered as item}
      <li class="collection__item" class:collection__item--thumbed={item.image}>
        {#if item.image}
          <img
            class="collection__thumb"
            src={item.image}
            alt={item.alt === undefined ? "" : item.alt}
            loading="lazy"
          />
        {/if}
        <div class="collection__body">
          <span class="collection__title">{item.title}</span>
          {#if item.category}<span class="collection__cat">{item.category}</span>{/if}
          {#if item.description}<p class="collection__desc">{item.description}</p>{/if}
          {#if item.links && item.links.length > 0}
            <span class="collection__links">
              {#each item.links as link}
                <a class="collection__link" href={link.href}>{link.label}</a>
              {/each}
            </span>
          {/if}
          {#if item.video}
            <div class="responsive-embed">
              <iframe
                src={embedSrc(item.video)}
                title={item.title}
                loading="lazy"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowfullscreen
              ></iframe>
            </div>
          {/if}
          {#if item.images && item.images.length > 0}
            <div class="media-gallery">
              {#each item.images as img}
                <figure class="media-gallery__item">
                  {#if img.href}
                    <a class="media-gallery__link" href={img.href}>
                      <img class="media-gallery__image" src={img.src} alt={img.alt === undefined ? "" : img.alt} loading="lazy" />
                    </a>
                  {:else}
                    <img class="media-gallery__image" src={img.src} alt={img.alt === undefined ? "" : img.alt} loading="lazy" />
                  {/if}
                </figure>
              {/each}
            </div>
          {/if}
        </div>
      </li>
    {/each}
  </ul>
  {#if filtered.length === 0}
    <p class="collection__status">No items match.</p>
  {/if}
{/if}
