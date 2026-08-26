import { describe, expect, it } from 'vitest'
import { safeLocalName } from './sftp-name-safety'

describe('safeLocalName', () => {
  it('keeps a plain filename unchanged', () => {
    expect(safeLocalName('/var/log/app.log')).toBe('app.log')
    expect(safeLocalName('notes.txt')).toBe('notes.txt')
  })

  it('keeps dotfiles and extension-less files unchanged', () => {
    expect(safeLocalName('/home/u/.bashrc')).toBe('.bashrc')
    expect(safeLocalName('/etc/hostname')).toBe('hostname')
  })

  it('strips directory components (posix and Windows separators)', () => {
    expect(safeLocalName('/a/b/c/file.json')).toBe('file.json')
    expect(safeLocalName('a\\b\\c\\file.json')).toBe('file.json')
  })

  it('rejects traversal and separator/NUL tricks', () => {
    expect(safeLocalName('..')).toBeNull()
    expect(safeLocalName('.')).toBeNull()
    expect(safeLocalName('../../etc/passwd')).toBe('passwd') // basename is safe
    expect(safeLocalName('foo/\0bar')).toBeNull()
    expect(safeLocalName('')).toBeNull()
  })

  it('neutralizes handler-executing extensions to .txt', () => {
    expect(safeLocalName('run.sh')).toBe('run.sh.txt')
    expect(safeLocalName('page.html')).toBe('page.html.txt')
    expect(safeLocalName('shortcut.desktop')).toBe('shortcut.desktop.txt')
    expect(safeLocalName('App.EXE')).toBe('App.EXE.txt') // case-insensitive
  })

  it('neutralizes the Windows Script Host family (the denylist used to miss these)', () => {
    // `.js` is JSFile -> WScript.exe "%1" on Windows: ShellExecute RUNS it, and
    // no execute bit is involved, so the temp copy would have executed.
    expect(safeLocalName('deploy-notes.js')).toBe('deploy-notes.js.txt')
    expect(safeLocalName('a.jse')).toBe('a.jse.txt')
    expect(safeLocalName('a.wsf')).toBe('a.wsf.txt')
    expect(safeLocalName('a.wsh')).toBe('a.wsh.txt')
    expect(safeLocalName('a.vbe')).toBe('a.vbe.txt')
    expect(safeLocalName('a.hta')).toBe('a.hta.txt')
  })

  it('neutralizes macOS and interpreter handlers', () => {
    // Terminal.app executes a .terminal file's embedded commandString.
    expect(safeLocalName('open-me.terminal')).toBe('open-me.terminal.txt')
    expect(safeLocalName('a.workflow')).toBe('a.workflow.txt')
    expect(safeLocalName('a.webloc')).toBe('a.webloc.txt')
    expect(safeLocalName('a.inetloc')).toBe('a.inetloc.txt')
    expect(safeLocalName('a.py')).toBe('a.py.txt')
    expect(safeLocalName('a.rb')).toBe('a.rb.txt')
    expect(safeLocalName('a.pl')).toBe('a.pl.txt')
    expect(safeLocalName('a.jar')).toBe('a.jar.txt')
  })

  it('is an allowlist: an unheard-of extension is neutralized, not trusted', () => {
    // The whole point of the inversion — no future OS association can surprise us.
    expect(safeLocalName('report.newthing')).toBe('report.newthing.txt')
    expect(safeLocalName('x.settingcontent-ms')).toBe('x.settingcontent-ms.txt')
    expect(safeLocalName('x.appref-ms')).toBe('x.appref-ms.txt')
  })

  it('neutralizes Windows trailing-dot/space extension bypasses', () => {
    // Windows strips trailing dots/spaces, so these would otherwise launch.
    expect(safeLocalName('payload.exe.')).toBe('payload.exe.txt')
    expect(safeLocalName('payload.exe ')).toBe('payload.exe.txt')
    expect(safeLocalName('payload.bat...  ')).toBe('payload.bat.txt')
  })

  it('rejects names that become empty after trimming trailing dots/spaces', () => {
    expect(safeLocalName('...')).toBeNull()
    expect(safeLocalName('   ')).toBeNull()
  })

  it('leaves inert text-ish extensions intact', () => {
    expect(safeLocalName('config.yaml')).toBe('config.yaml')
    expect(safeLocalName('data.json')).toBe('data.json')
    expect(safeLocalName('Makefile')).toBe('Makefile')
    expect(safeLocalName('nginx.conf')).toBe('nginx.conf')
    expect(safeLocalName('.env')).toBe('.env')
    expect(safeLocalName('schema.sql')).toBe('schema.sql')
    expect(safeLocalName('fix.patch')).toBe('fix.patch')
  })

  it('rejects Windows-reserved characters (NTFS ADS / extension-check bypass)', () => {
    // `notes.txt:payload.exe` is an alternate data stream: the extension check
    // would see `.txt` while the OS could execute the `:payload.exe` stream.
    expect(safeLocalName('notes.txt:payload.exe')).toBeNull()
    expect(safeLocalName('a:b')).toBeNull()
    expect(safeLocalName('weird*name.txt')).toBeNull()
    expect(safeLocalName('q?.txt')).toBeNull()
    expect(safeLocalName('a<b>.txt')).toBeNull()
    expect(safeLocalName('a|b.txt')).toBeNull()
    expect(safeLocalName('a"b.txt')).toBeNull()
  })
})
