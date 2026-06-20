<script lang="ts">
  let { data } = $props();
  const c = $derived(data.club);
  const mapsQuery = $derived(encodeURIComponent([c.address, c.postcode].filter(Boolean).join(', ')));
</script>

<nav class="crumbs"><a href="/">Home</a> › {c.name}</nav>
<h1>{c.name}</h1>

{#if c.address || c.postcode}
  <p>
    {#if c.address}{c.address}{/if}{#if c.postcode}{c.address ? ', ' : ''}{c.postcode}{/if}
    {#if mapsQuery}<br /><a href="https://www.google.com/maps/search/?api=1&query={mapsQuery}" target="_blank" rel="noopener">Open in Maps</a>{/if}
  </p>
{/if}

<h2>Teams</h2>
<div class="cards">
  {#each c.teams as team (team.division.slug + '/' + team.slug)}
    <a class="card" href="/teams/{team.division.slug}/{team.slug}">
      <h3>{team.name}</h3>
      <span class="muted">{team.division.name}</span>
    </a>
  {/each}
</div>
