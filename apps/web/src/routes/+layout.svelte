<script lang="ts">
  import '../app.css';
  let { children } = $props();
</script>

<header class="site">
  <div class="wrap">
    <a href="/">Calderdale Tennis League</a>
  </div>
</header>
<main class="wrap">
  {@render children()}
</main>
