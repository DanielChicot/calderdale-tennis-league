<script lang="ts">
  import { formatDate } from '$lib/format';
  let { data } = $props();
  const p = $derived(data.profile);
</script>

<nav class="crumbs"><a href="/">Home</a> › {p.player.name}</nav>
<h1>{p.player.name}</h1>
<p class="muted"><a href="/clubs/{p.club.slug}">{p.club.name}</a></p>

{#if p.rankings.length}
  <h2>Rankings</h2>
  <table>
    <thead><tr><th>Division</th><th class="num">Rank</th><th class="num">Score</th></tr></thead>
    <tbody>
      {#each p.rankings as r (r.division.slug)}
        <tr>
          <td><a href="/divisions/{r.division.slug}">{r.division.name}</a></td>
          <td class="num">{r.rank}</td>
          <td class="num">{r.rankingScore}</td>
        </tr>
      {/each}
    </tbody>
  </table>
{/if}

{#if p.matchHistory.length}
  <h2>Match history</h2>
  {#each p.matchHistory as m (m.fixtureId)}
    <div class="rubber">
      <div>
        <span class="muted">{formatDate(m.date)} · {m.division.name}</span>
        {#if m.sets.length}<span class="score"> {#each m.sets as s, i (i)}{i > 0 ? ', ' : ''}{s.home}-{s.away}{/each}</span>{/if}
        <a href="/matches/{m.fixtureId}">card →</a>
      </div>
      <div class="vs">
        with {#each m.partners as pp, i (pp.slug)}{i > 0 ? ', ' : ''}<a href="/players/{pp.slug}">{pp.name}</a>{:else}—{/each}
        · v {#each m.opponents as op, i (op.slug)}{i > 0 ? ', ' : ''}<a href="/players/{op.slug}">{op.name}</a>{/each}
      </div>
    </div>
  {/each}
{/if}
