<script lang="ts">
  let { data } = $props();
</script>

{#if data.currentSeason}
  <h1>{data.currentSeason.name}</h1>
  {#each data.groups as group (group.group)}
    <h2>{group.group}</h2>
    <div class="cards">
      {#each group.items as division (division.slug)}
        <a class="card" href="/divisions/{division.slug}">
          <h3>{division.name}</h3>
        </a>
      {/each}
    </div>
  {/each}
{:else}
  <h1>No current season</h1>
  <p class="muted">The database has no season marked current. Run a scrape to populate it.</p>
{/if}
