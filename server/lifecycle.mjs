export function createShutdownHandler(options = {}) {
  const { storeManager, exit = process.exit, timeoutMs = 10000 } = options
  let isShuttingDown = false
  let shutdownPromise = null

  return function shutdown(signal) {
    if (isShuttingDown) {
      return shutdownPromise
    }
    isShuttingDown = true

    const safetyTimer = setTimeout(() => {
      console.error(`[SERVER] Shutdown timed out after ${timeoutMs}ms on ${signal}`)
      exit(1)
    }, timeoutMs)
    if (typeof safetyTimer.unref === 'function') {
      safetyTimer.unref()
    }

    shutdownPromise = (async () => {
      const server = typeof options.getServer === 'function' ? options.getServer() : options.server
      try {
        if (server && server.listening) {
          if (typeof server.closeIdleConnections === 'function') {
            server.closeIdleConnections()
          }
          await new Promise(resolve => server.close(() => resolve()))
        }
      } catch (err) {
        console.error(`[SERVER] Failed closing server on ${signal}:`, err)
      }

      try {
        if (storeManager && typeof storeManager.flush === 'function') {
          await storeManager.flush()
        }
      } catch (err) {
        console.error(`[SERVER] Flush on ${signal} failed:`, err)
      } finally {
        clearTimeout(safetyTimer)
        exit(0)
      }
    })()

    return shutdownPromise
  }
}
