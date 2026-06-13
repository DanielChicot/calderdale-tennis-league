<script lang="ts">
  import { formatDate } from '$lib/format';
  let { data } = $props();
  let tab = $state<'standings' | 'fixtures' | 'rankings'>('standings');
</script>

<nav class="crumbs"><a href="/">Home</a> › {data.table.division.name}</nav>
<h1>{data.table.division.name}</h1>

<div class="tabs">
  <button class:active={tab === 'standings'} onclick={() => (tab = 'standings')}>Standings</button>
  <button class:active={tab === 'fixtures'} onclick={() => (tab = 'fixtures')}>Fixtures</button>
  <button class:active={tab === 'rankings'} onclick={() => (tab = 'rankings')}>Rankings</button>
</div>

{#if tab === 'standings'}
  <table>
    <thead>
      <tr><th>#</th><th>Team</th><th class="num">Recd</th><th class="num">Won</th><th class="num">Lost</th></tr>
    </thead>
    <tbody>
      {#each data.table.rows as row (row.teamId)}
        <tr>
          <td>{row.position}</td>
          <td><a href="/teams/{row.teamSlug}">{row.teamName}</a></td>
          <td class="num">{row.resultsReceived}/{row.resultsTotal}</td>
          <td class="num">{row.pointsWon}</td>
          <td class="num">{row.pointsLost}</td>
        </tr>
      {/each}
    </tbody>
  </table>
{:else if tab === 'fixtures'}
  {#each data.fixtures as f (f.id)}
    <div class="list-row">
      <span>
        <span class="muted">{formatDate(f.date)}</span>
        <a href="/teams/{f.homeTeam.slug}">{f.homeTeam.name}</a>
        {#if f.score}<span class="score"> {f.score.home}–{f.score.away} </span>{:else}<span class="muted"> v </span>{/if}
        <a href="/teams/{f.awayTeam.slug}">{f.awayTeam.name}</a>
      </span>
      {#if f.hasCard}<a href="/matches/{f.id}">card →</a>{/if}
    </div>
  {/each}
{:else}
  <table>
    <thead><tr><th>#</th><th>Player</th><th class="num">Score</th></tr></thead>
    <tbody>
      {#each data.rankings as r (r.playerId)}
        <tr><td>{r.rank}</td><td>{r.playerName}</td><td class="num">{r.rankingScore}</td></tr>
      {/each}
    </tbody>
  </table>
{/if}
