import { Button } from '@renderer/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@renderer/components/ui/dialog'
import { Input } from '@renderer/components/ui/input'
import { Label } from '@renderer/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@renderer/components/ui/select'
import { descendantIds, flattenGroupTree } from '@renderer/lib/group-tree'
import { cn } from '@renderer/lib/utils'
import { useHostsStore } from '@renderer/stores/hosts'
import type { Group, GroupInput } from '@shared/ipc'
import { Loader2, Pencil, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'

const NO_PARENT = '__root__'

/** A small fixed palette keeps group colors consistent and the picker simple. */
const SWATCHES = ['#ef4444', '#f59e0b', '#22c55e', '#06b6d4', '#6366f1', '#a855f7', '#ec4899']

function toMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '')
  }
  return String(error)
}

interface GroupsDialogProps {
  open: boolean
  onOpenChange(open: boolean): void
}

/** Manage groups and subgroups: create, rename, recolor, re-nest, delete. */
export function GroupsDialog({ open, onOpenChange }: GroupsDialogProps): React.JSX.Element {
  const groups = useHostsStore((s) => s.groups)
  const hosts = useHostsStore((s) => s.hosts)
  const deleteGroup = useHostsStore((s) => s.deleteGroup)
  const [editing, setEditing] = useState<Group | 'new' | null>(null)

  const rows = flattenGroupTree(groups)
  const directHostCount = (groupId: string): number =>
    hosts.filter((h) => h.groupId === groupId).length

  function close(next: boolean): void {
    if (!next) setEditing(null)
    onOpenChange(next)
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-lg" aria-describedby="groups-description">
        <DialogHeader>
          <DialogTitle>Groups</DialogTitle>
          <DialogDescription id="groups-description">
            Organize hosts into groups and subgroups. Deleting a group keeps its hosts (they become
            ungrouped) and promotes its subgroups to the top level.
          </DialogDescription>
        </DialogHeader>

        {editing ? (
          <GroupForm group={editing === 'new' ? null : editing} onDone={() => setEditing(null)} />
        ) : (
          <div className="flex flex-col gap-2">
            <ul className="flex max-h-80 flex-col gap-1 overflow-y-auto">
              {rows.length === 0 && (
                <li className="px-1 py-6 text-center text-sm text-muted-foreground">
                  No groups yet. Create one, then assign hosts to it from the host form.
                </li>
              )}
              {rows.map(({ group, depth }) => (
                <li
                  key={group.id}
                  className="flex items-center gap-2 rounded-md border px-2 py-2 text-sm"
                  style={{ marginLeft: depth * 16 }}
                >
                  <span
                    aria-hidden="true"
                    className="size-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: group.color ?? 'var(--muted-foreground)' }}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{group.name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {directHostCount(group.id)} host{directHostCount(group.id) === 1 ? '' : 's'}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8"
                    onClick={() => setEditing(group)}
                    aria-label={`Edit ${group.name}`}
                    title="Edit"
                  >
                    <Pencil className="size-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8 text-destructive"
                    onClick={() => void deleteGroup(group.id)}
                    aria-label={`Delete ${group.name}`}
                    title="Delete"
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </li>
              ))}
            </ul>
            <Button
              variant="secondary"
              size="sm"
              className="self-start"
              onClick={() => setEditing('new')}
            >
              <Plus /> Add group
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

function GroupForm({ group, onDone }: { group: Group | null; onDone(): void }): React.JSX.Element {
  const groups = useHostsStore((s) => s.groups)
  const createGroup = useHostsStore((s) => s.createGroup)
  const updateGroup = useHostsStore((s) => s.updateGroup)
  const isEdit = group != null

  const [name, setName] = useState(group?.name ?? '')
  const [color, setColor] = useState<string | null>(group?.color ?? null)
  const [parentId, setParentId] = useState<string>(group?.parentId ?? NO_PARENT)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  // When editing, a group can't be nested under itself or any of its descendants.
  const forbidden = group ? descendantIds(groups, group.id) : new Set<string>()
  const parentOptions = flattenGroupTree(groups).filter(({ group: g }) => !forbidden.has(g.id))

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (!name.trim()) {
      setError('Name is required')
      return
    }
    const input: GroupInput = {
      name: name.trim(),
      color,
      parentId: parentId === NO_PARENT ? null : parentId,
    }
    setSubmitting(true)
    try {
      if (group) await updateGroup(group.id, input)
      else await createGroup(input)
      onDone()
    } catch (err) {
      setError(toMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="group-name">Name</Label>
        <Input
          id="group-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Production"
          autoFocus
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="group-parent">Parent group</Label>
        <Select value={parentId} onValueChange={setParentId}>
          <SelectTrigger id="group-parent" className="w-full" aria-label="Parent group">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_PARENT}>No parent (top level)</SelectItem>
            {parentOptions.map(({ group: g, depth }) => (
              <SelectItem key={g.id} value={g.id} style={{ paddingLeft: 8 + depth * 14 }}>
                {g.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label>Color</Label>
        <div className="flex items-center gap-1.5">
          {SWATCHES.map((swatch) => (
            <button
              key={swatch}
              type="button"
              onClick={() => setColor(swatch)}
              aria-label={`Use color ${swatch}`}
              aria-pressed={color === swatch}
              className={cn(
                'size-6 rounded-full border-2 transition',
                color === swatch ? 'border-foreground' : 'border-transparent',
              )}
              style={{ backgroundColor: swatch }}
            />
          ))}
          <button
            type="button"
            onClick={() => setColor(null)}
            aria-label="No color"
            aria-pressed={color === null}
            className={cn(
              'flex size-6 items-center justify-center rounded-full border text-[9px] text-muted-foreground transition',
              color === null ? 'border-foreground' : 'border-border',
            )}
          >
            ✕
          </button>
        </div>
      </div>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={submitting}>
          {submitting && <Loader2 className="animate-spin" aria-hidden="true" />}
          {isEdit ? 'Save group' : 'Create group'}
        </Button>
      </div>
    </form>
  )
}
