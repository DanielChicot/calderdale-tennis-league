<script lang="ts">
  import { formatDate, formatScore } from '$lib/format';
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
          <td><a href="/teams/{data.table.division.slug}/{row.teamSlug}">{row.teamName}</a></td>
          <td class="num figs">{row.resultsReceived}/{row.resultsTotal}</td>
          <td class="num figs">{formatScore(row.pointsWon, 1)}</td>
          <td class="num figs">{formatScore(row.pointsLost, 1)}</td>
        </tr>
      {/each}
    </tbody>
  </table>
{:else if tab === 'fixtures'}
  <table class="fixtures">
    <tbody>
      {#each data.fixtures as f (f.id)}
        <tr>
          <td class="muted date">{formatDate(f.date)}</td>
          <td class="home"><a href="/teams/{f.divisionSlug}/{f.homeTeam.slug}">{f.homeTeam.name}</a></td>
          <td class="result">
            {#if f.score}<span class="score">{f.score.home}–{f.score.away}</span>{:else}<span class="muted">v</span>{/if}
          </td>
          <td class="away"><a href="/teams/{f.divisionSlug}/{f.awayTeam.slug}">{f.awayTeam.name}</a></td>
          <td class="card">{#if f.hasCard}<a href="/matches/{f.id}">card →</a>{/if}</td>
        </tr>
      {/each}
    </tbody>
  </table>
{:else}
  <table>
    <thead><tr><th>#</th><th>Player</th><th class="num">Score</th></tr></thead>
    <tbody>
      {#each data.rankings as r (r.playerId)}
        <tr><td>{r.rank}</td><td>{r.playerName}</td><td class="num figs">{formatScore(r.rankingScore)}</td></tr>
      {/each}
    </tbody>
  </table>
{/if}
