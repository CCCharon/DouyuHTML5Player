function convertHeader (headers) {
  let out = {}
  for (let key of headers.keys()) {
    out[key] = headers.get(key)
  }
  return out
}
class Fetch {
  constructor (port) {
    this.reader = null
    this.response = null
    this.port = port
  }
  onDisconnect () {
    if (this.reader) {
      this.reader.cancel()
    }
  }
  onMessage (msg) {
    // console.log('fetch new msg', msg)
    let chain = Promise.resolve()
    if (msg.method === 'fetch') {
      chain = chain.then(() => fetch.apply(null, msg.args)).then(r => {
        this.response = r
        console.log('response', r)
        return {
          bodyUsed: r.bodyUsed,
          ok: r.ok,
          status: r.status,
          statusText: r.statusText,
          type: r.type,
          url: r.url,
          headers: convertHeader(r.headers)
        }
      })
    } else if (msg.method === 'json') {
      chain = chain.then(() => this.response.json())
    } else if (msg.method === 'arrayBuffer') {
      chain = chain.then(() => this.response.arrayBuffer()).then(buf => {
        return Array.from(new Uint8Array(buf))
      })
    } else if (msg.method === 'body.getReader') {
      chain = chain.then(() => {
        this.reader = this.response.body.getReader()
        console.log('reader', this.reader)
      })
    } else if (msg.method === 'reader.read') {
      chain = chain.then(() => this.reader.read()).then(r => {
        // console.log('read', r)
        if (r.done === false) {
          r.value = Array.from(r.value)
        }
        return r
      })
    } else if (msg.method === 'reader.cancel') {
      chain = chain.then(() => this.reader.cancel())
    } else {
      this.port.disconnect()
      return
    }
    chain.then((...args) => {
      const outMsg = {
        method: msg.method,
        args: args
      }
      // console.log('fetch send msg', outMsg)
      this.port.postMessage(outMsg)
    }).catch(e => {
      console.log(e)
      this.port.postMessage({
        method: msg.method,
        err: {
          name: e.name,
          message: e.message,
          stack: e.stack,
          string: e.toString()
        }
      })
    })
  }
}
FlashEmu.BUILTIN = 'dist/builtin.abc'
FlashEmu.PLAYERGLOBAL = 'dist/playerglobal.abc'
FlashEmu.setGlobalFlags({
  enableDebug: false,
  enableLog: false,
  enableWarn: false,
  enableError: false
})
class Signer {
  static init () {
    if (!Signer.emu) {
      const emu = new FlashEmu({
        readFile (filename) {
          return fetch(filename)
            .then(res => res.arrayBuffer())
            .then(buf => new Uint8Array(buf).buffer)
        }
      })
      Signer.emu = emu
      return emu.runSWF('dist/douyu.swf', false).then(() => {
        const CModule = emu.getProperty('sample.mp', 'CModule')
        const xx = emu.getPublicClass('mp')
        Signer.CModule = CModule
        Signer.xx = xx
        CModule.callProperty('startAsync')
        Signer.ready = true
      })
    }
  }
  constructor (port) {
    this.port = port
    Signer.init()
  }
  douyuSign (roomId, time, did) {
    const CModule = Signer.CModule
    const xx = Signer.xx

    let StreamSignDataPtr = CModule.callProperty('malloc', 4)
    let outptr1 = CModule.callProperty('malloc', 4)

    let datalen = xx.callProperty('sub_2', parseInt(roomId), parseInt(time), did.toString(), outptr1, StreamSignDataPtr)

    let pSign = CModule.callProperty('read32', StreamSignDataPtr)
    let sign = CModule.callProperty('readString', pSign, datalen)
    let pOut = CModule.callProperty('read32', outptr1)
    let out = CModule.callProperty('readString', pOut, 4)
    CModule.callProperty('free', StreamSignDataPtr)
    CModule.callProperty('free', outptr1)
    console.log('sign result', sign)
    return {
      sign,
      cptl: out
    }
  }
  onDisconnect () {

  }
  onMessage (msg) {
    let args = []
    if (msg.method === 'query') {
      args.push(!!Signer.ready)
    } else if (msg.method === 'sign') {
      args.push(this.douyuSign(...msg.args))
    }
    this.port.postMessage({
      method: msg.method,
      args: args
    })
  }
}
Signer.init()
chrome.runtime.onConnect.addListener(port => {
  let handler
  if (port.name === 'fetch') {
    console.log('new fetch port', port)
    handler = new Fetch(port)
  } else if (port.name === 'signer') {
    console.log('new signer port', port)
    handler = new Signer(port)
  }
  port.onDisconnect.addListener(() => handler.onDisconnect())
  port.onMessage.addListener(msg => handler.onMessage(msg))
})
chrome.pageAction.onClicked.addListener(tab => {
  chrome.tabs.sendMessage(tab.id, {
    type: 'toggle'
  })
})
chrome.tabs.onUpdated.addListener((id, x, tab) => {
  if (/https?:\/\/[^\/]*\.douyu\.com(\/|$)/.test(tab.url)) {
    chrome.pageAction.show(tab.id)
  } else {
    chrome.pageAction.hide(tab.id)
  }
})
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  switch (request.type) {
    case 'disable':
      chrome.pageAction.setIcon({
        tabId: sender.tab.id,
        path: 'dist/img/disabled.png'
      })
      break
  }
})
