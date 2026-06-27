<script lang="ts">
  import '../app.css';
  import { page } from '$app/stores';
  let { children } = $props();
</script>

<header class="site">
  <div class="wrap">
    <a class="brand" href="/">
      <span class="dot"></span>
      Calderdale Tennis <span class="sub">· League</span>
    </a>
    <nav>
      <a href="/" class:active={$page.url.pathname === '/'}>Standings</a>
    </nav>
  </div>
</header>
<main class="wrap">
  {@render children()}
</main>
