export interface SendTextPayload {
  phone: string
  message: string
  delayMs?: number
}

export interface SendMediaPayload {
  phone: string
  url: string
  caption?: string
  fileName?: string
  mimetype?: string
}

export interface SendButtonsPayload {
  phone: string
  title: string
  footer?: string
  buttons: Array<{
    id: string
    text: string
  }>
}

export interface SendListPayload {
  phone: string
  title: string
  description: string
  buttonText: string
  footer?: string
  sections: Array<{
    title: string
    rows: Array<{
      id: string
      title: string
      description?: string
    }>
  }>
}

export interface WebhookPayload {
  event: WebhookEvent
  instanceId: string
  instanceName: string
  data: Record<string, any>
  timestamp: number
}

export type WebhookEvent =
  | 'qr.updated'
  | 'connection.update'
  | 'message.received'
  | 'message.sent'
  | 'message.ack'
  | 'presence.update'
  | 'group.update'

export interface InstanceInfo {
  id: string
  name: string
  token: string
  status: string
  phone?: string | null
  profileName?: string | null
  profilePic?: string | null
  webhookUrl?: string | null
}
