<script lang="ts">
  let { data } = $props();
</script>

<nav class="crumbs"><a href="/">Home</a> › Find your name</nav>
<h1>Find your name</h1>
<p class="muted">Pick yourself to pin your results to the homepage on this device.</p>

<form method="GET" class="searchbox" role="search">
  <input type="search" name="q" value={data.q} placeholder="Your name…" aria-label="Player name" />
  <button type="submit">Search</button>
</form>

{#if data.q.length < 2}
  <p class="muted">Type at least two letters of your name.</p>
{:else if data.results.length === 0}
  <p class="muted">No players match "{data.q}".</p>
{:else}
  <div class="cards">
    {#each data.results as p (p.slug)}
      <a class="card" href="/players/{p.slug}">
        <h3>{p.name}</h3>
        <p class="muted">{p.club.name}</p>
      </a>
    {/each}
  </div>
{/if}
