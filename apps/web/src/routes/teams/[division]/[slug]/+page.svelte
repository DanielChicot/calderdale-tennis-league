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
<table class="fixtures">
  <tbody>
    {#each t.fixtures as f (f.id)}
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

{#if t.squad.length}
  <h2>Players seen this season</h2>
  <div class="cards">
    {#each t.squad as p (p.slug)}<a class="card" href="/players/{p.slug}"><h3>{p.name}</h3></a>{/each}
  </div>
{/if}
