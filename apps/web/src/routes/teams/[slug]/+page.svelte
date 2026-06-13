<script lang="ts">
  import { formatDate } from '$lib/format';
  let { data } = $props();
  const t = $derived(data.team);
</script>

<nav class="crumbs">
  <a href="/">Home</a> › <a href="/divisions/{t.division.slug}">{t.division.name}</a> › {t.name}
</nav>
<h1>{t.name}</h1>
<p class="muted"><a href="/clubs/{t.club.slug}">{t.club.name}</a> · {t.division.name}</p>

{#if t.contacts.length}
  <h2>Contacts</h2>
  {#each t.contacts as contact (contact.name)}
    <div class="list-row">
      <span>{contact.name}{#if contact.role} <span class="muted">· {contact.role}</span>{/if}</span>
      <span class="muted">{contact.phone ?? ''}{contact.phone && contact.email ? ' · ' : ''}{contact.email ?? ''}</span>
    </div>
  {/each}
{/if}

<h2>Fixtures & Results</h2>
{#each t.fixtures as f (f.id)}
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

{#if t.squad.length}
  <h2>Players seen this season</h2>
  <div class="cards">
    {#each t.squad as p (p.slug)}<a class="card" href="/players/{p.slug}"><h3>{p.name}</h3></a>{/each}
  </div>
{/if}
