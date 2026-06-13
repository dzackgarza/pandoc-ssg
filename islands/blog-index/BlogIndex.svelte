<script lang="ts">
  // The interactive blog index island. Fetches the build-emitted posts.json and
  // provides client-side search + tag filtering — the replacement for the
  // dropped tag/year/category archive pages.
  interface Post {
    title: string;
    date: string;
    url: string;
    tags: string[];
    categories: string[];
  }

  let { postsUrl }: { postsUrl: string } = $props();

  let posts = $state<Post[]>([]);
  let loaded = $state(false);
  let query = $state("");
  let activeTag = $state<string | null>(null);
  let activeCategory = $state<string | null>(null);

  $effect(() => {
    // No catch: a failed fetch rejects and surfaces as an uncaught rejection,
    // which `ssg verify` reports as a page-error (fail loud, never silent).
    fetch(postsUrl)
      .then((r) => r.json())
      .then((data: Post[]) => {
        posts = data;
        loaded = true;
      });
  });

  let allTags = $derived([...new Set(posts.flatMap((p) => p.tags))].sort());
  let allCategories = $derived([...new Set(posts.flatMap((p) => p.categories))].sort());

  let filtered = $derived(
    posts.filter((p) => {
      let matchesTag = activeTag === null || p.tags.includes(activeTag);
      let matchesCategory = activeCategory === null || p.categories.includes(activeCategory);
      let matchesQuery = query === "" || p.title.toLowerCase().includes(query.toLowerCase());
      return matchesTag && matchesCategory && matchesQuery;
    }),
  );
</script>

<div class="blog-index">
  <input
    class="blog-index__search"
    type="search"
    placeholder="Search posts…"
    aria-label="Search posts"
    bind:value={query}
  />
  <div class="blog-index__tags" role="group" aria-label="Filter by tag">
    <button
      type="button"
      class="blog-index__tag"
      class:is-active={activeTag === null}
      onclick={() => (activeTag = null)}
    >
      All
    </button>
    {#each allTags as tag}
      <button
        type="button"
        class="blog-index__tag"
        class:is-active={activeTag === tag}
        onclick={() => (activeTag = tag)}
      >
        {tag}
      </button>
    {/each}
  </div>
  {#if allCategories.length > 0}
    <div class="blog-index__categories" role="group" aria-label="Filter by category">
      <button
        type="button"
        class="blog-index__category"
        class:is-active={activeCategory === null}
        onclick={() => (activeCategory = null)}
      >
        All
      </button>
      {#each allCategories as category}
        <button
          type="button"
          class="blog-index__category"
          class:is-active={activeCategory === category}
          onclick={() => (activeCategory = category)}
        >
          {category}
        </button>
      {/each}
    </div>
  {/if}

  {#if !loaded}
    <p class="blog-index__status">Loading posts…</p>
  {:else}
    <ul class="blog-index__list">
      {#each filtered as post}
        <li class="blog-index__item" data-tags={post.tags.join(",")}>
          <a class="blog-index__link" href={post.url}>{post.title}</a>
          <time class="blog-index__date" datetime={post.date}>{post.date}</time>
          {#each post.tags as tag}
            <span class="blog-index__item-tag">{tag}</span>
          {/each}
        </li>
      {/each}
    </ul>
    {#if filtered.length === 0}
      <p class="blog-index__status">No posts match.</p>
    {/if}
  {/if}
</div>
