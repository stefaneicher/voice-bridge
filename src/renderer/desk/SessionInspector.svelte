<script lang="ts">
  import { DESK_STATUS_LABEL } from '../../core/desk';
  import type { AppConfig } from '../../shared/config';
  import { settings } from '../lib/settings-store.svelte';
  import { desk } from './desk-store.svelte';

  const session = $derived(desk.pinned);
  const stt = $derived(settings.data?.config.stt);

  type Switch = {
    label: string;
    on: (c: AppConfig) => boolean;
    set: (c: AppConfig, v: boolean) => void;
  };
  // Only settings that apply without a restart (pressEnter/bracketedPaste need one).
  const SWITCHES: Switch[] = [
    {
      label: 'Live-Transkription',
      on: (c) => c.stt.live.enabled,
      set: (c, v) => (c.stt.live.enabled = v),
    },
    {
      label: 'Hochdeutsch (Text glätten)',
      on: (c) => c.stt.polish.enabled,
      set: (c, v) => (c.stt.polish.enabled = v),
    },
    {
      label: 'Rohtranskript anzeigen',
      on: (c) => c.stt.showRawTranscript,
      set: (c, v) => (c.stt.showRawTranscript = v),
    },
  ];
</script>

<div class="inspector">
  <h3>Ziel-Session</h3>
  {#if session}
    <dl>
      <dt>Titel</dt>
      <dd>{session.title || session.name}</dd>
      <dt>ID</dt>
      <dd><code>{session.id}</code></dd>
      <dt>Ordner</dt>
      <dd>{session.cwd ?? '–'}</dd>
      <dt>Status</dt>
      <dd class="status {session.status}">{DESK_STATUS_LABEL[session.status]}</dd>
    </dl>
    {#if session.status === 'gone'}
      <p class="note">
        Diese Session ist getrennt. Prompts werden nicht an eine andere Session umgeleitet – wähle
        links ein neues Ziel.
      </p>
    {:else}
      <button class="action" onclick={() => window.vb.revealSession(session.id)}
        >Terminal anzeigen</button
      >
    {/if}
  {:else}
    <p class="note">
      Keine Session gewählt. Klicke links auf eine Session, um sie als Ziel zu fixieren.
    </p>
  {/if}

  {#if stt && settings.data}
    <h3>Schnellschalter</h3>
    {#each SWITCHES as sw (sw.label)}
      <label class="switch">
        <input
          type="checkbox"
          checked={sw.on(settings.data.config)}
          onchange={(e) => {
            const value = e.currentTarget.checked;
            void settings.apply((c) => sw.set(c, value));
          }}
        />
        {sw.label}
      </label>
    {/each}
  {/if}
</div>

<style>
  .inspector {
    padding: 12px 14px 20px;
  }
  h3 {
    margin: 8px 0 10px;
    font: 600 12px var(--font-ui);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--vb-text-3);
  }
  h3:not(:first-child) {
    margin-top: 24px;
  }
  dl {
    display: grid;
    grid-template-columns: 70px 1fr;
    gap: 6px 10px;
    margin: 0 0 12px;
    font-size: 13px;
  }
  dt {
    color: var(--vb-text-3);
  }
  dd {
    margin: 0;
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .status.ready {
    color: var(--vb-agent);
  }
  .status.busy {
    color: #e8b14a;
  }
  .status.gone {
    color: var(--vb-rec);
  }
  code {
    font-family: var(--font-mono);
    font-size: 12px;
  }
  .note {
    margin: 0 0 12px;
    font-size: 13px;
    line-height: 1.5;
    color: var(--vb-text-3);
  }
  .action {
    padding: 7px 12px;
    border: 1px solid var(--vb-line);
    border-radius: 8px;
    background: var(--vb-ink-3);
    color: var(--vb-text);
    font: 500 13px var(--font-ui);
    cursor: pointer;
  }
  .action:hover {
    border-color: var(--vb-agent);
  }
  .switch {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 0;
    font-size: 13px;
    cursor: pointer;
  }
</style>
