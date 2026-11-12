<script lang="ts">
  import type { InspectorTab } from '../../shared/ipc';
  import { settings } from '../lib/settings-store.svelte';
  import Settings from '../settings/Settings.svelte';
  import Composer from './Composer.svelte';
  import { desk } from './desk-store.svelte';
  import SessionInspector from './SessionInspector.svelte';
  import SessionList from './SessionList.svelte';

  // Collapse variant B «Schiene» (ADR-018): a collapsed pane becomes a 28px rail.
  let leftCollapsed = $state(false);
  let rightCollapsed = $state(false);
  let tab = $state<InspectorTab>('session');

  void settings.load().then(() => {
    const desk = settings.data?.config.desk;
    if (!desk) return;
    leftCollapsed = desk.leftCollapsed;
    rightCollapsed = desk.rightCollapsed;
  });

  function setLayout(left: boolean, right: boolean) {
    if (left === leftCollapsed && right === rightCollapsed) return;
    leftCollapsed = left;
    rightCollapsed = right;
    window.vb.setDeskLayout({ leftCollapsed: left, rightCollapsed: right });
  }

  function showInspector(next: InspectorTab) {
    tab = next;
    setLayout(leftCollapsed, false);
  }

  $effect(() => desk.start());

  $effect(() =>
    window.vb.onDeskOpen((next) => {
      if (next) showInspector(next);
    }),
  );

  const columns = $derived(
    `44px ${leftCollapsed ? '28px' : '260px'} minmax(0, 1fr) ${
      rightCollapsed ? '28px' : tab === 'settings' ? '460px' : '340px'
    }`,
  );
</script>

<div class="desk" style:grid-template-columns={columns}>
  <nav class="tools" aria-label="Werkzeuge">
    <button
      class="tool"
      class:on={!leftCollapsed}
      title="Sessions ein- oder ausklappen"
      aria-label="Sessions"
      aria-pressed={!leftCollapsed}
      onclick={() => setLayout(!leftCollapsed, rightCollapsed)}>☰</button
    >
    <button
      class="tool"
      class:on={!rightCollapsed && tab === 'session'}
      title="Session-Details"
      aria-label="Session-Details"
      onclick={() => showInspector('session')}>ⓘ</button
    >
    <span class="spacer"></span>
    <button
      class="tool"
      class:on={!rightCollapsed && tab === 'settings'}
      title="Einstellungen"
      aria-label="Einstellungen"
      onclick={() => showInspector('settings')}>⚙</button
    >
  </nav>

  {#if leftCollapsed}
    <button
      class="rail"
      title="Sessions aufklappen"
      onclick={() => setLayout(false, rightCollapsed)}
    >
      <span>Sessions</span>
    </button>
  {:else}
    <section class="pane left" aria-label="Sessions">
      <header>
        <h2>Sessions</h2>
        <button
          class="icon"
          title="Einklappen"
          aria-label="Sessions einklappen"
          onclick={() => setLayout(true, rightCollapsed)}>‹</button
        >
      </header>
      <div class="body">
        <SessionList onOpen={() => showInspector('session')} />
      </div>
    </section>
  {/if}

  <main class="center">
    <Composer />
  </main>

  {#if rightCollapsed}
    <button
      class="rail"
      title="Inspektor aufklappen"
      onclick={() => setLayout(leftCollapsed, false)}
    >
      <span>{tab === 'settings' ? 'Einstellungen' : 'Inspektor'}</span>
    </button>
  {:else}
    <section class="pane right" aria-label="Inspektor">
      <header>
        <div class="tabs" role="tablist">
          <button
            role="tab"
            aria-selected={tab === 'session'}
            class:active={tab === 'session'}
            onclick={() => (tab = 'session')}>Session</button
          >
          <button
            role="tab"
            aria-selected={tab === 'settings'}
            class:active={tab === 'settings'}
            onclick={() => (tab = 'settings')}>Einstellungen</button
          >
        </div>
        <button
          class="icon"
          title="Einklappen"
          aria-label="Inspektor einklappen"
          onclick={() => setLayout(leftCollapsed, true)}>›</button
        >
      </header>
      <div class="body">
        {#if tab === 'settings'}
          <Settings />
        {:else}
          <SessionInspector />
        {/if}
      </div>
    </section>
  {/if}

  <footer class="status">
    {#if settings.data}
      <span>Profil {settings.data.config.profile}</span>
      <span>Pipe <code>{settings.data.pipePath}</code></span>
      <span class="grow"></span>
      <span>Version {settings.data.version}</span>
    {/if}
  </footer>
</div>

<style>
  :global(html[data-view='desk']),
  :global(html[data-view='desk'] body) {
    background:
      radial-gradient(circle at 12% 0%, rgba(42, 165, 161, 0.08), transparent 40%),
      radial-gradient(circle at 100% 100%, rgba(163, 216, 88, 0.05), transparent 45%), var(--vb-ink);
    color: var(--vb-text);
    height: 100%;
    overflow: hidden;
  }
  :global(html[data-view='desk'] #app) {
    height: 100%;
  }
  .desk {
    display: grid;
    grid-template-rows: minmax(0, 1fr) 26px;
    height: 100vh;
  }
  .tools {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    padding: 8px 0;
    background: var(--vb-ink-2);
    border-right: 1px solid var(--vb-line);
  }
  .tool {
    width: 32px;
    height: 32px;
    border: 0;
    border-radius: 8px;
    background: transparent;
    color: var(--vb-text-3);
    font-size: 16px;
    cursor: pointer;
  }
  .tool:hover {
    background: var(--vb-ink-3);
    color: var(--vb-text);
  }
  .tool.on {
    background: var(--vb-ink-3);
    color: var(--vb-dictate);
    box-shadow: 0 0 0 1px var(--vb-line);
  }
  .spacer {
    flex: 1;
  }
  .rail {
    display: flex;
    justify-content: center;
    padding: 12px 0;
    border: 0;
    border-right: 1px solid var(--vb-line);
    border-left: 1px solid var(--vb-line);
    background: var(--vb-ink-2);
    color: var(--vb-text-3);
    cursor: pointer;
    font: 600 12px var(--font-ui);
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }
  .rail:hover {
    color: var(--vb-text);
    background: var(--vb-ink-3);
  }
  .rail span {
    writing-mode: vertical-rl;
  }
  .pane {
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    background: rgba(29, 29, 39, 0.85);
  }
  .pane.left {
    border-right: 1px solid var(--vb-line);
  }
  .pane.right {
    border-left: 1px solid var(--vb-line);
  }
  .pane header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    height: 40px;
    flex: none;
    padding: 0 8px 0 12px;
    border-bottom: 1px solid var(--vb-line);
  }
  h2 {
    margin: 0;
    font: 600 12px var(--font-ui);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--vb-text-3);
  }
  .icon {
    width: 26px;
    height: 26px;
    border: 0;
    border-radius: 6px;
    background: transparent;
    color: var(--vb-text-3);
    font-size: 16px;
    cursor: pointer;
  }
  .icon:hover {
    background: var(--vb-ink-3);
    color: var(--vb-text);
  }
  .tabs {
    display: flex;
    gap: 2px;
  }
  .tabs button {
    padding: 5px 10px;
    border: 0;
    border-radius: 6px;
    background: transparent;
    color: var(--vb-text-3);
    font: 500 13px var(--font-ui);
    cursor: pointer;
  }
  .tabs button.active {
    background: var(--vb-ink-3);
    color: var(--vb-dictate);
  }
  .body {
    flex: 1;
    min-height: 0;
    overflow: auto;
  }
  .center {
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
  }
  .status {
    grid-column: 1 / -1;
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 0 12px;
    border-top: 1px solid var(--vb-line);
    background: var(--vb-ink-2);
    color: var(--vb-text-3);
    font-size: 12px;
    white-space: nowrap;
    overflow: hidden;
  }
  .grow {
    flex: 1;
  }
  code {
    font-family: var(--font-mono);
    font-size: 11px;
  }
</style>
