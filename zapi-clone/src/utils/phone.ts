/**
 * Normalizes a phone number to the JID format used by Baileys
 * Accepts: +55 (11) 99999-9999, 5511999999999, 11999999999, etc.
 */
export function formatPhone(phone: string): string {
  // Remove everything that is not a digit
  let cleaned = phone.replace(/\D/g, '')

  // Add country code if missing (assume Brazil)
  if (cleaned.length === 11 || cleaned.length === 10) {
    cleaned = `55${cleaned}`
  }

  // WhatsApp JID format
  return `${cleaned}@s.whatsapp.net`
}

/**
 * Formats a group JID
 */
export function formatGroup(groupId: string): string {
  if (groupId.includes('@g.us')) return groupId
  return `${groupId}@g.us`
}

/**
 * Extracts the phone number from a JID
 */
export function jidToPhone(jid: string): string {
  return jid.split('@')[0]
}

/**
 * Checks if a JID is a group
 */
export function isGroup(jid: string): boolean {
  return jid.endsWith('@g.us')
}
