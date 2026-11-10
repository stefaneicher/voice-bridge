<script lang="ts">
  let { levels, color }: { levels: number[]; color: string } = $props();
</script>

<div class="wave" aria-hidden="true">
  {#each levels as level, i (i)}
    <i style:height="{Math.round(4 + level * 16)}px" style:background={color}></i>
  {/each}
</div>

<style>
  .wave {
    display: flex;
    align-items: center;
    gap: 2px;
    height: 20px;
  }
  i {
    display: block;
    width: 2px;
    border-radius: 2px;
    transition: height 80ms linear;
  }
</style>
