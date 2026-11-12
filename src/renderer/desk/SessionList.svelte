<script lang="ts">
  import { DESK_STATUS_LABEL } from '../../core/desk';
  import { folderName } from '../../core/selection';
  import { desk } from './desk-store.svelte';

  let { onOpen }: { onOpen: () => void } = $props();
</script>

<div class="list">
  {#if desk.data && desk.data.sessions.length > 0}
    <ul role="listbox" aria-label="Sessions">
      {#each desk.data.sessions as s (s.id)}
        <li role="option" aria-selected={s.pinned}>
          <button
            class="row"
            class:pinned={s.pinned}
            title={s.status === 'gone'
              ? 'Session getrennt – Ziel bleibt fixiert, bis du ein anderes wählst'
              : 'Als Ziel fixieren'}
            onclick={() => desk.pin(s.id)}
            ondblclick={() => onOpen()}
          >
            <span class="dot {s.status}" aria-hidden="true"></span>
            <span class="text">
              <span class="name" class:gone={s.status === 'gone'}>{s.title || s.name}</span>
              <span class="meta">
                {s.folder ?? s.name} · {DESK_STATUS_LABEL[s.status]}
              </span>
            </span>
            {#if s.pinned}<span class="badge">Ziel</span>{/if}
          </button>
        </li>
      {/each}
    </ul>
  {:else if desk.data}
    <p class="empty">
      Noch keine Sessions. Starte eine mit «＋ Neue Session» oder im Terminal mit <code
        >vb run -- copilot</code
      >.
    </p>
  {/if}

  {#if desk.data?.canLaunch}
    <div class="launch">
      <button
        class="new"
        disabled={desk.launching}
        title={desk.data.newFolder
          ? `Neues Terminal in ${desk.data.newFolder}`
          : 'Ordner wählen und neues Terminal öffnen'}
        onclick={() => desk.launch(desk.data?.newFolder ?? null)}
      >
        ＋ Neue Session
        {#if desk.data.newFolder}<span class="in">in {folderName(desk.data.newFolder)}</span>{/if}
      </button>
      {#if desk.data.newFolder}
        <button
          class="other"
          disabled={desk.launching}
          title="Anderen Ordner wählen"
          aria-label="Neue Session in anderem Ordner"
          onclick={() => desk.launch(null)}>…</button
        >
      {/if}
    </div>
    {#if desk.launching}<p class="hint">Terminal startet …</p>{/if}
    {#if desk.launchError}<p class="error" role="alert">{desk.launchError}</p>{/if}
  {/if}
</div>

<style>
  .list {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 8px;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 8px 10px;
    border: 0;
    border-radius: 8px;
    background: transparent;
    color: var(--vb-text);
    text-align: left;
    cursor: pointer;
  }
  .row:hover {
    background: var(--vb-ink-3);
  }
  .row.pinned {
    background: var(--vb-ink-3);
    box-shadow: inset 2px 0 0 var(--vb-agent);
  }
  .dot {
    flex: none;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--vb-dim);
  }
  .dot.ready {
    background: var(--vb-agent);
  }
  .dot.busy {
    background: #e8b14a;
  }
  .dot.gone {
    background: transparent;
    box-shadow: inset 0 0 0 1.5px var(--vb-rec);
  }
  .text {
    display: flex;
    flex-direction: column;
    min-width: 0;
    flex: 1;
  }
  .name,
  .meta {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .name {
    font: 500 13px var(--font-ui);
  }
  .name.gone {
    text-decoration: line-through;
    color: var(--vb-text-3);
  }
  .meta {
    font-size: 12px;
    color: var(--vb-text-3);
  }
  .badge {
    flex: none;
    padding: 1px 6px;
    border-radius: 999px;
    background: var(--vb-agent);
    color: var(--vb-on-accent);
    font: 600 11px var(--font-ui);
  }
  .launch {
    display: flex;
    gap: 4px;
  }
  .new,
  .other {
    padding: 8px 10px;
    border: 1px dashed var(--vb-line);
    border-radius: 8px;
    background: transparent;
    color: var(--vb-text-2);
    font: 500 13px var(--font-ui);
    cursor: pointer;
    text-align: left;
  }
  .new {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .new:hover:not(:disabled),
  .other:hover:not(:disabled) {
    border-color: var(--vb-agent);
    color: var(--vb-text);
  }
  button:disabled {
    opacity: 0.6;
    cursor: default;
  }
  .in {
    color: var(--vb-text-3);
  }
  .empty,
  .hint,
  .error {
    margin: 4px 2px;
    font-size: 12px;
    line-height: 1.5;
    color: var(--vb-text-3);
  }
  .error {
    color: var(--vb-rec);
  }
  code {
    font-family: var(--font-mono);
    font-size: 11px;
  }
</style>
