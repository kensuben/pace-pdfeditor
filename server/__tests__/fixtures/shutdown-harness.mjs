import { CoalescedStore } from '../../store.mjs'
import { createShutdownHandler } from '../../lifecycle.mjs'

const dataFile = process.env.DATA_FILE
if (!dataFile) {
  console.error('DATA_FILE environment variable required')
  process.exit(1)
}

const store = { users: [], groups: [], logs: [] }
const storeManager = new CoalescedStore({
  file: dataFile,
  getStore: () => store,
  delayMs: 10000,
})

store.users.push({ id: 'k2-sigterm-user', name: 'Saved via real SIGTERM' })
storeManager.scheduleSave()

const dummyServer = { listening: false }
const shutdown = createShutdownHandler({
  server: dummyServer,
  storeManager,
  exit: code => process.exit(code),
})

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))

process.stdout.write('READY\n')
