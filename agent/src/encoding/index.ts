// Browser-native encoding — no Node.js Buffer

export interface AgentEncoder {
  encode(data: unknown): string
  decode<T>(data: string): T
}

export class JsonEncoder implements AgentEncoder {
  encode(data: unknown): string {
    return JSON.stringify(data)
  }
  decode<T>(data: string): T {
    return JSON.parse(data) as T
  }
}

export class Base64JsonEncoder implements AgentEncoder {
  encode(data: unknown): string {
    return btoa(JSON.stringify(data))
  }
  decode<T>(data: string): T {
    return JSON.parse(atob(data)) as T
  }
}

export const defaultEncoder: AgentEncoder = new JsonEncoder()
