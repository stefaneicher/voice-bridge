<script lang="ts">
  import { PromptHistory, insertAtCaret } from '../../core/composer';
  import { desk } from './desk-store.svelte';

  // Composer (ADR-018): sends to the pinned session only; on failure the text stays.
  let text = $state('');
  let error = $state('');
  let sending = $state(false);
  let field = $state<HTMLTextAreaElement | null>(null);
  let recalled: string | null = null;
  const history = new PromptHistory();

  const entries = $derived(desk.data?.history ?? []);
  const target = $derived(desk.pinned);
  const canSend = $derived(!!text.trim() && !!target && target.status !== 'gone' && !sending);

  // Main pushes desk data often; reload only when the history really changed (keeps the cursor).
  let loaded = '';
  $effect(() => {
    const key = entries.join('\u0000');
    if (key === loaded) return;
    loaded = key;
    history.load(entries);
  });

  // Dictation goes here while the desk has focus, unless another text field is active.
  $effect(() => {
    let active = true;
    window.vb.setComposerActive(true);
    const onFocus = (e: FocusEvent) => {
      const el = e.target as HTMLElement | null;
      const editable =
        !!el && (el.matches('input, textarea, select') || el.isContentEditable === true);
      const next = el === field || !editable;
      if (next !== active) window.vb.setComposerActive((active = next));
    };
    document.addEventListener('focusin', onFocus);
    const off = window.vb.onComposerText((t) => {
      const el = field;
      const start = el?.selectionStart ?? text.length;
      const end = el?.selectionEnd ?? text.length;
      const next = insertAtCaret(text, start, end, t);
      text = next.value;
      error = '';
      queueMicrotask(() => {
        el?.setSelectionRange(next.caret, next.caret);
      });
    });
    return () => {
      document.removeEventListener('focusin', onFocus);
      off();
      window.vb.setComposerActive(false);
    };
  });

  async function send() {
    if (!canSend) return;
    sending = true;
    error = '';
    const sent = text;
    try {
      const result = await window.vb.sendPrompt(sent);
      if (!result) error = 'Senden nicht möglich.';
      else if (!result.ok) error = result.message;
      else if (text === sent) text = '';
    } catch (err) {
      error = `Senden fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`;
    } finally {
      sending = false;
      recalled = null;
      history.resetCursor();
    }
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      void send();
      return;
    }
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    if (text !== '' && text !== recalled) return;
    const next = e.key === 'ArrowUp' ? history.older() : history.newer();
    if (next === undefined) return;
    e.preventDefault();
    text = next;
    recalled = next;
  }

  function recall(entry: string) {
    text = entry;
    recalled = null;
    history.resetCursor();
    field?.focus();
  }
</script>

<div class="composer">
  <div class="target">
    {#if target}
      An <strong>{target.title || target.name}</strong>
      {#if target.folder}<span class="folder">· {target.folder}</span>{/if}
      {#if target.status === 'gone'}<span class="gone">· getrennt</span>{/if}
    {:else}
      Keine Ziel-Session gewählt – links eine Session wählen.
    {/if}
  </div>
  <textarea
    bind:this={field}
    bind:value={text}
    oninput={() => {
      recalled = null;
      history.resetCursor();
    }}
    onkeydown={onKey}
    placeholder="Prompt eingeben oder diktieren … (Strg+Enter sendet)"
    aria-label="Prompt"
    rows="5"></textarea>
  <div class="actions">
    {#if error}<p class="error" role="alert">{error}</p>{/if}
    <span class="grow"></span>
    <button class="send" disabled={!canSend} onclick={() => void send()}>
      {sending ? 'Sende …' : 'Senden'}
    </button>
  </div>

  <section class="history" aria-label="Verlauf">
    <h3>Verlauf (diese Sitzung)</h3>
    {#if entries.length === 0}
      <p class="hint">Noch nichts gesendet.</p>
    {:else}
      <ul>
        {#each entries as entry, i (i)}
          <li>
            <button title="In das Textfeld übernehmen" onclick={() => recall(entry)}>{entry}</button
            >
          </li>
        {/each}
      </ul>
    {/if}
  </section>
</div>

<style>
  .composer {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 16px;
    min-height: 0;
    height: 100%;
    box-sizing: border-box;
  }
  .target {
    color: var(--vb-text-3);
    font-size: 13px;
  }
  .target strong {
    color: var(--vb-text);
    font-weight: 600;
  }
  .gone {
    color: var(--vb-rec);
  }
  textarea {
    resize: vertical;
    min-height: 96px;
    padding: 10px 12px;
    border: 1px solid var(--vb-line);
    border-radius: 10px;
    background: var(--vb-ink-2);
    color: var(--vb-text);
    font: 14px/1.45 var(--font-ui);
  }
  textarea:focus {
    outline: none;
    border-color: var(--vb-agent);
  }
  .actions {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .grow {
    flex: 1;
  }
  .error {
    margin: 0;
    color: var(--vb-rec);
    font-size: 13px;
  }
  .send {
    padding: 7px 16px;
    border: 0;
    border-radius: 8px;
    background: var(--vb-agent);
    color: var(--vb-on-accent);
    font: 600 13px var(--font-ui);
    cursor: pointer;
  }
  .send:disabled {
    background: var(--vb-ink-3);
    color: var(--vb-dim);
    cursor: default;
  }
  .history {
    flex: 1;
    min-height: 0;
    overflow: auto;
    border-top: 1px solid var(--vb-line);
    padding-top: 8px;
  }
  h3 {
    margin: 0 0 6px;
    font: 600 12px var(--font-ui);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--vb-text-3);
  }
  .hint {
    margin: 0;
    color: var(--vb-dim);
    font-size: 13px;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  li button {
    display: block;
    width: 100%;
    padding: 6px 8px;
    border: 0;
    border-radius: 6px;
    background: transparent;
    color: var(--vb-text-2);
    font: 13px var(--font-ui);
    text-align: left;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    cursor: pointer;
  }
  li button:hover {
    background: var(--vb-ink-3);
    color: var(--vb-text);
  }
</style>
