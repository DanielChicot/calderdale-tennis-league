<script lang="ts">
  let { data } = $props();
</script>

<section class="hero">
  <span class="eyebrow">Calderdale Tennis League — Season Report</span>
  <h1>
    <span class="outline">Calderdale</span><br />
    <span class="solid">Tennis</span>
  </h1>
  <p class="lede">
    Every division, every rubber, every set. Browse the standings, dig into the results, and
    follow the clubs across the league.
  </p>
</section>

{#if data.currentSeason}
  <div class="stats">
    <div class="stat">
      <div class="label">Season</div>
      <div class="value">{data.currentSeason.name}</div>
      <div class="note">current</div>
    </div>
    <div class="stat">
      <div class="label">Divisions</div>
      <div class="value">{data.stats.divisions}</div>
      <div class="note">in play</div>
    </div>
    <div class="stat">
      <div class="label">Clubs</div>
      <div class="value">{data.stats.clubs}</div>
      <div class="note">across the league</div>
    </div>
    <div class="stat">
      <div class="label">Seasons</div>
      <div class="value">{data.stats.seasons}</div>
      <div class="note">on record</div>
    </div>
  </div>

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
