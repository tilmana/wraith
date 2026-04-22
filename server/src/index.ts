import { createServer } from './server.js'
import { registry } from './modules/registry.js'
import { discoverModules } from './modules/discover.js'

const modules = await discoverModules()
for (const mod of modules) {
  registry.register(mod)
}

createServer().catch((err) => {
  console.error('[wraith] fatal error:', err)
  process.exit(1)
})
