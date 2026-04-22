import { readdir, access } from 'fs/promises'
import { pathToFileURL } from 'url'
import path from 'path'
import { fileURLToPath } from 'url'
import type { WraithModule } from '@wraith/types'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const MODULES_DIR = path.resolve(__dirname, '../../../modules')

export async function discoverModules(): Promise<WraithModule[]> {
  const entries = await readdir(MODULES_DIR, { withFileTypes: true })
  const modules: WraithModule[] = []

  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const indexPath = path.join(MODULES_DIR, entry.name, 'index.jsx')
    try {
      await access(indexPath)
    } catch {
      continue
    }
    try {
      const raw = await import(pathToFileURL(indexPath).href)
      const mod = raw.default ?? raw
      if (!mod.id || !mod.name || !mod.version) {
        console.warn(`[discover] skipping ${entry.name}: missing id, name, or version`)
        continue
      }
      modules.push(mod as WraithModule)
    } catch (err) {
      console.warn(`[discover] failed to load ${entry.name}:`, err)
    }
  }

  console.log(`[discover] found ${modules.length} module(s): ${modules.map(m => m.id).join(', ')}`)
  return modules
}
