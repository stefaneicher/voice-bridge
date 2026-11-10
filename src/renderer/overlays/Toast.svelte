<script lang="ts">
  import type { FailureView } from '../../shared/ipc';
  import { autosize } from '../lib/autosize';
  import { formatSeconds, formatTimer, truncate } from '../lib/format';
  import { overlay } from '../lib/state.svelte';

  const DONE_VISIBLE_MS = 2500;

  const view = $derived(overlay.view);
  const done = $derived(view.kind === 'done' ? view : null);

  let doneVisible = $state(false);
  let hovering = $state(false);
  let showRaw = $state(true);
  let pickingFor = $state<string | null>(null);

  $effect(() => {
    if (!done) {
      doneVisible = false;
      return;
    }
    doneVisible = true;
    showRaw = true;
    const t = setTimeout(() => (doneVisible = false), DONE_VISIBLE_MS);
    return () => clearTimeout(t);
  });

  const showDone = $derived(!!done && (doneVisible || hovering));
  const failures = $derived(overlay.failures);
  const visible = $derived(showDone || failures.length > 0);
  const anchor = $derived(
    failures.length > 0 || done?.mode === 'agent' ? 'bottom-right' : 'bottom-center',
  );

  const TITLES: Record<FailureView['kind'], string> = {
    recorder: 'Aufnahme fehlgeschlagen',
    stt: 'Transkription fehlgeschlagen',
    'session-gone': 'Session beendet',
    'no-sessions': 'Keine Session gewählt',
    delivery: 'Senden fehlgeschlagen',
    'no-textfield': 'Kein Textfeld aktiv',
    insert: 'Einfügen fehlgeschlagen',
  };

  function act(f: FailureView, type: 'retry' | 'discard' | 'copy') {
    window.vb.resolveFailure(f.id, { type });
  }

  function sendTo(f: FailureView, sessionId: string) {
    pickingFor = null;
    window.vb.resolveFailure(f.id, { type: 'send-to', sessionId });
  }
</script>

{#if visible}
  <div
    class="overlay-frame stack"
    use:autosize={anchor}
    onmouseenter={() => (hovering = true)}
    onmouseleave={() => (hovering = false)}
    role="presentation"
  >
    {#each failures as f (f.id)}
      <div class="card error" role="alertdialog" aria-labelledby="t-{f.id}">
        <div class="title" id="t-{f.id}">
          <span class="badge">!</span>
          {TITLES[f.kind]}
        </div>
        <p class="msg">{f.message}</p>
        {#if f.text}
          <blockquote>«{truncate(f.text, 280)}»</blockquote>
        {:else if f.audioMs}
          <div class="meta mono">
            Aufnahme {formatTimer(f.audioMs)}{f.target ? ` · Ziel bleibt: ${f.target.name}` : ''}
          </div>
        {/if}

        {#if pickingFor === f.id}
          <div class="pick" role="listbox" aria-label="Andere Session wählen">
            {#each overlay.sessions as s (s.id)}
              <button
                class="vb-btn"
                role="option"
                aria-selected="false"
                onclick={() => sendTo(f, s.id)}
              >
                {s.name}
              </button>
            {:else}
              <span class="meta"
                >Keine laufende Session. Starte eine mit <code>vb run -- copilot</code>.</span
              >
            {/each}
          </div>
        {/if}

        <div class="actions">
          {#if f.kind === 'session-gone' || f.kind === 'no-sessions'}
            <button
              class="vb-btn primary"
              style:background="var(--vb-agent)"
              onclick={() => (pickingFor = pickingFor === f.id ? null : f.id)}
            >
              Andere Session wählen
            </button>
            <button class="vb-btn" onclick={() => act(f, 'copy')}>Kopieren</button>
          {:else if f.kind === 'stt'}
            <button
              class="vb-btn primary"
              style:background="var(--vb-dictate)"
              onclick={() => act(f, 'retry')}
            >
              Erneut versuchen
            </button>
          {:else if f.kind === 'delivery'}
            <button
              class="vb-btn primary"
              style:background="var(--vb-agent)"
              onclick={() => act(f, 'retry')}
            >
              Erneut senden
            </button>
            <button class="vb-btn" onclick={() => (pickingFor = pickingFor === f.id ? null : f.id)}
              >Andere Session</button
            >
            <button class="vb-btn" onclick={() => act(f, 'copy')}>Kopieren</button>
          {:else if f.kind === 'no-textfield'}
            <button
              class="vb-btn primary"
              style:background="var(--vb-dictate)"
              onclick={() => act(f, 'discard')}>OK</button
            >
          {:else if f.text}
            <button
              class="vb-btn primary"
              style:background="var(--vb-dictate)"
              onclick={() => act(f, 'copy')}>Kopieren</button
            >
          {/if}
          {#if f.kind !== 'no-textfield'}
            <button class="vb-btn" onclick={() => act(f, 'discard')}>Verwerfen</button>
          {/if}
        </div>
      </div>
    {/each}

    {#if showDone && done}
      {#if done.showRaw && done.rawText && showRaw}
        <div class="card raw">
          <div class="meta">Rohtranskript · Mundart</div>
          <p class="rawtext">«{done.rawText}»</p>
        </div>
      {/if}
      <div class="card" role="status">
        <div class="title">
          <span
            class="check"
            style:background={done.mode === 'agent' ? 'var(--vb-agent)' : 'var(--vb-dictate)'}
            >✓</span
          >
          {#if done.mode === 'agent'}
            Gesendet an <span class="mono">{done.target?.name}</span>
          {:else}
            Eingefügt
          {/if}
          <span class="meta right">
            {done.mode === 'dictate' ? `${done.words} Wörter · ` : ''}{formatSeconds(
              done.elapsedMs,
            )}
          </span>
        </div>
        {#if done.mode === 'agent'}
          <blockquote>«{truncate(done.text, 160)}»</blockquote>
          <div class="actions">
            <span class="meta">Fokus unverändert</span>
            <button class="vb-btn" onclick={() => window.vb.copyText(done.text)}>Kopieren</button>
            {#if done.target}
              <button
                class="vb-btn"
                onclick={() => done.target && window.vb.revealSession(done.target.id)}
                >Session zeigen</button
              >
            {/if}
          </div>
        {:else if done.showRaw}
          <div class="actions">
            <span class="meta">Mundart → Hochdeutsch</span>
            <button class="vb-btn" onclick={() => (showRaw = !showRaw)}>
              Rohtranskript {showRaw ? 'ausblenden' : 'einblenden'}
            </button>
          </div>
        {/if}
      </div>
    {/if}
  </div>
{/if}

<style>
  .stack {
    display: flex;
    flex-direction: column;
    gap: 10px;
    width: 520px;
  }
  .card {
    border-radius: 16px;
    background: var(--vb-ink);
    border: 1px solid var(--vb-line);
    box-shadow: var(--vb-shadow);
    color: var(--vb-text);
    padding: 14px 16px;
  }
  .card.error {
    width: 400px;
    align-self: flex-end;
    border-color: rgba(255, 90, 95, 0.45);
  }
  .card.raw {
    background: var(--vb-ink-3);
  }
  .title {
    display: flex;
    align-items: center;
    gap: 10px;
    font-weight: 600;
    font-size: 14px;
  }
  .badge,
  .check {
    display: inline-grid;
    place-items: center;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    font-size: 12px;
    color: var(--vb-on-accent);
    flex: none;
  }
  .badge {
    background: var(--vb-rec);
  }
  .msg {
    font-size: 13px;
    color: var(--vb-text-2);
    margin: 8px 0;
    line-height: 1.45;
  }
  blockquote {
    margin: 8px 0;
    padding: 10px 12px;
    border-radius: 10px;
    background: var(--vb-ink-3);
    font-size: 13px;
    color: var(--vb-text);
    line-height: 1.45;
    user-select: text;
  }
  .rawtext {
    margin: 6px 0 0;
    font-size: 13px;
    color: var(--vb-text-2);
    font-style: italic;
  }
  .meta {
    font-size: 12px;
    color: var(--vb-text-3);
  }
  .right {
    margin-left: auto;
    font-weight: 400;
  }
  .actions {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 10px;
    flex-wrap: wrap;
  }
  .actions .meta {
    margin-right: auto;
  }
  .pick {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin: 8px 0;
  }
  code {
    font-family: var(--font-mono);
    color: var(--vb-agent);
  }
</style>
