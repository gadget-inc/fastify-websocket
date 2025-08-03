'use strict'

const test = require('tap').test
const Fastify = require('fastify')
const fastifyWebsocket = require('..')
const WebSocket = require('ws')
const { once } = require('node:events')

test('Should use custom handleUpgradeRequest function successfully', async (t) => {
  t.plan(4)

  const fastify = Fastify()
  t.teardown(() => fastify.close())

  await fastify.register(fastifyWebsocket)

  let customUpgradeCalled = false

  fastify.get('/', {
    websocket: true,
    handleUpgradeRequest: async (request, socket, head) => {
      customUpgradeCalled = true
      t.equal(typeof socket, 'object', 'socket parameter is provided')
      t.equal(Buffer.isBuffer(head), true, 'head parameter is a buffer')

      return new Promise((resolve) => {
        fastify.websocketServer.handleUpgrade(request.raw, socket, head, (ws) => {
          resolve(ws)
        })
      })
    }
  }, (socket) => {
    socket.on('message', (data) => {
      socket.send(`echo: ${data}`)
    })
    t.teardown(() => socket.terminate())
  })

  await fastify.listen({ port: 0 })

  const ws = new WebSocket('ws://localhost:' + fastify.server.address().port)
  t.teardown(() => ws.close())

  await once(ws, 'open')
  ws.send('hello')

  const [message] = await once(ws, 'message')
  t.equal(message.toString(), 'echo: hello')

  // Verify our custom function was called
  t.ok(customUpgradeCalled, 'custom handleUpgradeRequest was called')
})

test('Should handle errors in custom handleUpgradeRequest gracefully', async (t) => {
  t.plan(1)

  const fastify = Fastify()
  t.teardown(() => fastify.close())

  await fastify.register(fastifyWebsocket)

  fastify.get('/', {
    websocket: true,
    handleUpgradeRequest: async (request, socket, head) => {
      throw new Error('Custom upgrade error')
    }
  }, () => {
    t.fail('websocket handler should not be called when upgrade fails')
  })

  await fastify.listen({ port: 0 })

  const ws = new WebSocket('ws://localhost:' + fastify.server.address().port)

  let wsErrorResolved
  const wsErrorPromise = new Promise((resolve) => {
    wsErrorResolved = resolve
  })

  ws.on('error', (error) => {
    wsErrorResolved(error)
  })

  const wsError = await wsErrorPromise

  t.equal(wsError.message, 'Unexpected server response: 500')
  t.end()
})

test('Should allow for user to send a response to the client', async (t) => {
  t.plan(1)

  const fastify = Fastify()
  t.teardown(() => fastify.close())

  await fastify.register(fastifyWebsocket)

  fastify.get('/', {
    websocket: true,
    handleUpgradeRequest: async (request, socket, head) => {
      const error = new Error('Forbidden')
      error.statusCode = 403
      throw error
    }
  }, () => {
    t.fail('websocket handler should not be called when upgrade fails')
  })

  await fastify.listen({ port: 0 })

  const ws = new WebSocket('ws://localhost:' + fastify.server.address().port)

  let wsErrorResolved
  const wsErrorPromise = new Promise((resolve) => {
    wsErrorResolved = resolve
  })

  ws.on('error', (error) => {
    wsErrorResolved(error)
  })

  const wsError = await wsErrorPromise

  t.equal(wsError.message, 'Unexpected server response: 403')
  t.end()
})

test('does not send a response if the client has already ended the underlying socket', async (t) => {
  t.plan(1)

  const fastify = Fastify()
  t.teardown(() => fastify.close())

  await fastify.register(fastifyWebsocket)

  fastify.get('/', {
    websocket: true,
    handleUpgradeRequest: async (request, socket, head) => {
      socket.write('HTTP/1.1 400 Bad Request\r\n')
      socket.write('Connection: closed\r\n')
      socket.write('\r\n')
      socket.end()

      throw new Error('thrown after response has ended')
    }
  }, () => {
    t.fail('websocket handler should not be called when upgrade fails')
  })

  await fastify.listen({ port: 0 })

  const ws = new WebSocket('ws://localhost:' + fastify.server.address().port)

  let wsErrorResolved
  const wsErrorPromise = new Promise((resolve) => {
    wsErrorResolved = resolve
  })

  ws.on('error', (error) => {
    wsErrorResolved(error)
  })

  const wsError = await wsErrorPromise

  t.equal(wsError.message, 'Unexpected server response: 400')
  t.end()
})

test('Should work with async handleUpgradeRequest that returns a Promise', async (t) => {
  t.plan(2)

  const fastify = Fastify()
  t.teardown(() => fastify.close())

  await fastify.register(fastifyWebsocket)

  fastify.get('/', {
    websocket: true,
    handleUpgradeRequest: (request, socket, head) => {
      return new Promise((resolve) => {
        setTimeout(() => {
          fastify.websocketServer.handleUpgrade(request.raw, socket, head, (ws) => {
            resolve(ws)
          })
        }, 10)
      })
    }
  }, (socket) => {
    socket.send('async upgrade successful')
    t.teardown(() => socket.terminate())
  })

  await fastify.listen({ port: 0 })

  const ws = new WebSocket('ws://localhost:' + fastify.server.address().port)
  t.teardown(() => ws.close())

  const messagePromise = once(ws, 'message')
  await once(ws, 'open')

  const [message] = await messagePromise
  t.equal(message.toString(), 'async upgrade successful')
  t.pass('async handleUpgradeRequest worked correctly')
})
