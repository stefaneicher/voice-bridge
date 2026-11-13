<script lang="ts">
  import type { SessionView } from '../../core/types';
  import { autosize } from '../lib/autosize';
  import { formatAgo, formatTimer, liveTail } from '../lib/format';
  import { overlay } from '../lib/state.svelte';
  import Waveform from './Waveform.svelte';

  const view = $derived(overlay.view);
  const rec = $derived(view.kind === 'recording' && view.mode === 'agent' ? view : null);
  const sessions = $derived(rec?.sessions ?? []);

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

  /** A looked-up title (e.g. the Copilot session name) replaces the terminal name. */
  const label = (s: SessionView): string => s.title ?? s.name;

  function detail(s: SessionView): string {
    const folder = s.cwd?.split(/[\\/]/).filter(Boolean).at(-1);
    if (s.newSession) return folder ? `in ${folder}` : '';
    if (!s.title) return s.cwd ?? s.command ?? '';
    return folder ? `${folder} · ${s.name}` : s.name;
  }
</script>

{#if rec}
  <div class="overlay-frame stack" use:autosize={'cursor'}>
    {#if overlay.liveText}
      <div class="live"><span>{liveTail(overlay.liveText, 600)}</span></div>
    {/if}
    <div class="popup" data-overlay-anchor>
      <div class="head" role="status" aria-label="Agent-Aufnahme läuft">
        <span class="rec-dot"></span>
        <Waveform levels={overlay.levels} color="var(--vb-agent)" />
        <span class="mono timer">{formatTimer(overlay.now - rec.startedAt)}</span>
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
              class:new={s.newSession}
              role="option"
              aria-selected={isSel}
              data-id={s.id}
              disabled={s.gone}
              onclick={() => window.vb.selectSession(s.id)}
            >
              {#if s.newSession}
                <span class="plus" aria-hidden="true">＋</span>
              {:else}
                <span
                  class="dot"
                  style:background={s.gone
                    ? 'var(--vb-rec)'
                    : s.state === 'busy'
                      ? 'var(--vb-agent)'
                      : 'var(--vb-dictate)'}
                ></span>
              {/if}
              <span class="text">
                <span class="name" class:mono={!s.title && !s.newSession}>{label(s)}</span>
                <span class="task">{detail(s)}</span>
              </span>
              {#if isSel && !s.gone}
                <span class="target">Ziel</span>
              {:else if !s.newSession}
                <span class="status">{status(s)}</span>
              {/if}
            </button>
          {/each}
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  /* Same width as the popup: live text grows upward, the popup itself never moves.
     content-box: the frame padding must not eat into the 420 px, or the popup's right edge is clipped. */
  .stack {
    box-sizing: content-box;
    display: flex;
    flex-direction: column;
    gap: 8px;
    width: 420px;
  }
  .live {
    box-sizing: border-box;
    max-height: 168px;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    padding: 10px 16px;
    border-radius: 14px;
    border-left: 3px solid var(--vb-agent);
    background: var(--vb-ink);
    border-top: 1px solid var(--vb-line);
    border-right: 1px solid var(--vb-line);
    border-bottom: 1px solid var(--vb-line);
    box-shadow: var(--vb-shadow);
    color: var(--vb-text);
    font-size: 14px;
    line-height: 1.4;
  }
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
  .timer {
    font-size: 12px;
    color: var(--vb-text-2);
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
    background: rgba(163, 216, 88, 0.12);
    box-shadow: inset 0 0 0 1px rgba(163, 216, 88, 0.5);
  }
  .row.gone {
    cursor: default;
    opacity: 0.7;
  }
  .row.gone .name {
    text-decoration: line-through;
  }
  /* The virtual «Neue Session» row: dashed and muted until it is the target. */
  .row.new {
    outline: 1px dashed rgba(255, 255, 255, 0.18);
    outline-offset: -1px;
    color: var(--vb-text-2);
  }
  .row.new.sel {
    outline-color: rgba(163, 216, 88, 0.6);
    color: var(--vb-text);
  }
  .row.new .name {
    color: inherit;
  }
  .plus {
    width: 8px;
    flex: none;
    display: inline-grid;
    place-items: center;
    font-size: 14px;
    line-height: 1;
    color: var(--vb-agent);
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
    color: var(--vb-on-accent);
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
</style>
