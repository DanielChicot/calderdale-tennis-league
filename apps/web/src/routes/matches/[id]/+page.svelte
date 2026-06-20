<script lang="ts">
  import { formatDate } from '$lib/format';
  let { data } = $props();
  const fx = $derived(data.card.fixture);
</script>

<nav class="crumbs">
  <a href="/">Home</a> › <a href="/divisions/{fx.division.slug}">{fx.division.name}</a> › Match
</nav>
<h1>
  <a href="/teams/{fx.division.slug}/{fx.homeTeam.slug}">{fx.homeTeam.name}</a>
  {#if fx.score}<span class="score">{fx.score.home}–{fx.score.away}</span>{:else}v{/if}
  <a href="/teams/{fx.division.slug}/{fx.awayTeam.slug}">{fx.awayTeam.name}</a>
</h1>
<p class="muted">{formatDate(fx.date)}</p>

{#each data.card.rubbers as rubber (rubber.orderInCard)}
  <div class="rubber">
    <div>{#each rubber.homePlayers as p, i (p.slug)}{i > 0 ? ' & ' : ''}<a href="/players/{p.slug}">{p.name}</a>{/each}</div>
    <div class="vs">vs</div>
    <div>{#each rubber.awayPlayers as p, i (p.slug)}{i > 0 ? ' & ' : ''}<a href="/players/{p.slug}">{p.name}</a>{/each}</div>
    <div class="score">{#each rubber.sets as s, i (i)}{i > 0 ? ', ' : ''}{s.home}-{s.away}{/each}</div>
  </div>
{/each}
