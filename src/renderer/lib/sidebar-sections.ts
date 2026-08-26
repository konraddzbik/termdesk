import type { SidebarSectionId } from '@shared/ipc'

/** A toggleable sidebar section's id + the label shown in Settings. */
export interface SidebarSectionMeta {
  id: SidebarSectionId
  label: string
  /** Short helper text under the toggle. */
  hint: string
}

/**
 * Display metadata for the sidebar-section toggles, in sidebar order. Derived
 * from `SIDEBAR_SECTION_IDS` so the Settings UI and the schema can never drift.
 */
export const SIDEBAR_SECTIONS: readonly SidebarSectionMeta[] = [
  { id: 'hosts', label: 'Hosts', hint: 'The host list and its search box' },
  { id: 'localTerminals', label: 'Local terminals', hint: 'Saved local-terminal directories' },
  { id: 'workspaces', label: 'Workspaces', hint: 'Saved side-by-side directory sets' },
  { id: 'tunnels', label: 'Tunnels', hint: 'Saved SSH port forwards' },
  { id: 'snippets', label: 'Snippets', hint: 'Reusable command snippets' },
  { id: 'promptBook', label: 'Prompt Book', hint: 'Reusable templated AI prompts' },
  { id: 'routines', label: 'Routines', hint: 'Run a prompt in an agent, on a schedule' },
]
