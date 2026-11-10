<script lang="ts">
  import { autosize } from '../lib/autosize';
  import { formatTimer } from '../lib/format';
  import { overlay } from '../lib/state.svelte';
  import Waveform from './Waveform.svelte';

  const view = $derived(overlay.view);
  const recording = $derived(view.kind === 'recording' && view.mode === 'dictate' ? view : null);
  const working = $derived(view.kind === 'working' ? view : null);
</script>

{#if recording}
  <div class="overlay-frame" use:autosize={'bottom-center'}>
    <div class="pill" role="status" aria-live="polite">
      <span class="rec-dot"></span>
      <span class="label">Diktat</span>
      <Waveform levels={overlay.levels} color="var(--vb-dictate)" />
      <span class="mono timer">{formatTimer(overlay.now - recording.startedAt)}</span>
      <span class="chip" style:background="var(--vb-dictate)">{recording.hotkeyLabel}</span>
      <span class="hint">Loslassen zum Einfügen · Esc bricht ab</span>
    </div>
  </div>
{:else if working}
  <div class="overlay-frame" use:autosize={'bottom-center'}>
    <div class="pill" role="status" aria-live="polite">
      <span
        class="spinner"
        style:border-top-color={working.mode === 'agent' ? 'var(--vb-agent)' : 'var(--vb-dictate)'}
      ></span>
      <span class="label">{working.label}</span>
      {#if working.cancellable}
        <span class="hint">Esc bricht ab</span>
      {/if}
    </div>
  </div>
{/if}

<style>
  .pill {
    display: flex;
    align-items: center;
    gap: 12px;
    height: 60px;
    padding: 0 20px;
    border-radius: 30px;
    background: var(--vb-ink);
    border: 1px solid var(--vb-line);
    box-shadow: var(--vb-shadow);
    color: var(--vb-text);
    white-space: nowrap;
  }
  .label {
    font-size: 14px;
    font-weight: 600;
  }
  .timer {
    font-size: 12px;
    color: var(--vb-text-2);
  }
  .hint {
    font-size: 12px;
    color: var(--vb-text-3);
    padding-left: 4px;
  }
  .spinner {
    width: 16px;
    height: 16px;
    border-radius: 50%;
    border: 2px solid rgba(255, 255, 255, 0.15);
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .spinner {
      animation: none;
    }
  }
</style>
