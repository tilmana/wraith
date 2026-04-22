import type { Encoder } from '@wraith/types'

export class JsonEncoder implements Encoder {
  encode(data: unknown): string {
    return JSON.stringify(data)
  }

  decode<T>(data: string | Uint8Array): T {
    const raw = typeof data === 'string' ? data : Buffer.from(data).toString('utf8')
    return JSON.parse(raw) as T
  }
}

export class Base64JsonEncoder implements Encoder {
  encode(data: unknown): string {
    return Buffer.from(JSON.stringify(data)).toString('base64')
  }

  decode<T>(data: string | Uint8Array): T {
    const raw = typeof data === 'string' ? data : Buffer.from(data).toString('utf8')
    return JSON.parse(Buffer.from(raw, 'base64').toString('utf8')) as T
  }
}

export const defaultEncoder: Encoder = new JsonEncoder()
