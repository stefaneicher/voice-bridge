<script lang="ts">
  import type { SessionView } from '../../core/types';
  import { autosize } from '../lib/autosize';
  import { formatAgo, formatTimer } from '../lib/format';
  import { overlay } from '../lib/state.svelte';
  import Waveform from './Waveform.svelte';

  const view = $derived(overlay.view);
  const rec = $derived(view.kind === 'recording' && view.mode === 'agent' ? view : null);
  const sessions = $derived(rec?.sessions ?? []);
  const live = $derived(sessions.filter((s) => !s.gone));
  const selected = $derived(sessions.find((s) => s.id === rec?.selectedId));

  let list: HTMLElement | undefined = $state();

  // Keep the selected row visible when the wheel moves past the 8 visible rows.
  $effect(() => {
    const id = rec?.selectedId;
    if (!list || !id) return;
    list
      .querySelector<HTMLElement>(`[data-id="${CSS.escape(id)}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  });

  function status(s: SessionView): string {
    if (s.gone) return 'beendet';
    if (s.state === 'busy') return 'arbeitet …';
    const ago = formatAgo(s.lastActivity, overlay.now);
    return ago ? `wartet · ${ago}` : 'wartet';
  }
</script>

{#if rec}
  <div class="overlay-frame" use:autosize={'cursor'}>
    <div class="popup">
      <div class="head" role="status">
        <span class="rec-dot"></span>
        <span class="label">Agent</span>
        <Waveform levels={overlay.levels} color="var(--vb-agent)" />
        <span class="mono timer">{formatTimer(overlay.now - rec.startedAt)}</span>
        <span class="chip" style:background="var(--vb-agent)">{rec.hotkeyLabel}</span>
      </div>
      <div class="meta">
        <span>Copilot CLI · {live.length} {live.length === 1 ? 'Session' : 'Sessions'}</span>
        <span>Profil {rec.profile}</span>
      </div>

      {#if rec.loading}
        <div class="empty">Suche Sessions …</div>
      {:else if sessions.length === 0}
        <div class="empty">
          <strong>Keine Sessions gefunden</strong>
          <span
            >Starte einen Agent mit <code>vb run -- copilot</code>. Die Aufnahme läuft trotzdem.</span
          >
        </div>
      {:else}
        <div class="rows" role="listbox" aria-label="Agent-Sessions" bind:this={list}>
          {#each sessions as s (s.id)}
            {@const isSel = s.id === rec.selectedId}
            <button
              class="row"
              class:sel={isSel}
              class:gone={s.gone}
              role="option"
              aria-selected={isSel}
              data-id={s.id}
              disabled={s.gone}
              onclick={() => window.vb.selectSession(s.id)}
            >
              <span
                class="dot"
                style:background={s.gone
                  ? 'var(--vb-rec)'
                  : s.state === 'busy'
                    ? 'var(--vb-agent)'
                    : 'var(--vb-dictate)'}
              ></span>
              <span class="text">
                <span class="name mono">{s.name}</span>
                <span class="task">{s.title ?? s.cwd ?? s.command ?? ''}</span>
              </span>
              {#if isSel && !s.gone}
                <span class="target">Ziel</span>
              {:else}
                <span class="status">{status(s)}</span>
              {/if}
            </button>
          {/each}
        </div>
      {/if}

      <div class="foot">
        <span>Mausrad wechselt</span>
        <span>Klick wählt</span>
        <span class="release">
          Loslassen → {selected
            ? selected.gone
              ? `${selected.name} (beendet)`
              : selected.name
            : 'kein Ziel'}
        </span>
      </div>
    </div>
  </div>
{/if}

<style>
  .popup {
    width: 420px;
    border-radius: 16px;
    background: var(--vb-ink);
    border: 1px solid var(--vb-line);
    box-shadow: var(--vb-shadow);
    color: var(--vb-text);
    overflow: hidden;
  }
  .head {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 14px 16px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.07);
  }
  .head .chip {
    margin-left: auto;
  }
  .label {
    font-size: 14px;
    font-weight: 600;
  }
  .timer {
    font-size: 12px;
    color: var(--vb-text-2);
  }
  .meta {
    display: flex;
    justify-content: space-between;
    padding: 10px 16px 4px;
    font-size: 11px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--vb-text-3);
  }
  .rows {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 4px 8px 8px;
    max-height: calc(8 * 56px + 12px);
    overflow-y: auto;
    scrollbar-width: none;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 12px;
    width: 100%;
    min-height: 54px;
    padding: 8px 10px;
    border: 0;
    border-radius: 10px;
    background: transparent;
    color: inherit;
    text-align: left;
    cursor: pointer;
    font-family: var(--font-ui);
    transition: background 0.12s;
  }
  .row:hover {
    background: rgba(255, 255, 255, 0.05);
  }
  .row.sel {
    background: rgba(255, 181, 71, 0.14);
    box-shadow: inset 0 0 0 1px rgba(255, 181, 71, 0.55);
  }
  .row.gone {
    cursor: default;
    opacity: 0.7;
  }
  .row.gone .name {
    text-decoration: line-through;
  }
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex: none;
  }
  .text {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
    flex: 1;
  }
  .name {
    font-size: 13px;
    color: var(--vb-text);
  }
  .task {
    font-size: 12px;
    color: var(--vb-text-3);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .status {
    font-size: 12px;
    color: var(--vb-text-3);
    white-space: nowrap;
  }
  .target {
    font-size: 11px;
    font-weight: 600;
    color: var(--vb-ink);
    background: var(--vb-agent);
    padding: 3px 8px;
    border-radius: 10px;
  }
  .empty {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 16px;
    font-size: 13px;
    color: var(--vb-text-2);
  }
  code {
    font-family: var(--font-mono);
    color: var(--vb-agent);
  }
  .foot {
    display: flex;
    gap: 16px;
    padding: 11px 16px;
    background: var(--vb-ink-2);
    border-top: 1px solid rgba(255, 255, 255, 0.07);
    font-size: 12px;
    color: #aeb5c2;
  }
  .release {
    margin-left: auto;
    color: #ffcb80;
  }
</style>
