import { describe, expect, it } from 'vitest'
import { signCursor, verifyCursor, type CursorPayload } from './cursor'

const SECRET = 'a'.repeat(32)
const OTHER_SECRET = 'b'.repeat(32)

const payload: CursorPayload = {
  sort: 'newest',
  value: '2026-01-01T00:00:00.000Z',
  id: '11111111-1111-4111-8111-111111111111',
}

describe('signCursor / verifyCursor', () => {
  it('round-trips a payload', () => {
    const cursor = signCursor(payload, SECRET)
    expect(verifyCursor(cursor, SECRET)).toEqual(payload)
  })

  it('rejects a cursor with a flipped character in the signature half', () => {
    const cursor = signCursor(payload, SECRET)
    const [body, signature] = cursor.split('.')
    const tamperedSignature = signature![0] === 'a' ? `b${signature!.slice(1)}` : `a${signature!.slice(1)}`
    expect(verifyCursor(`${body}.${tamperedSignature}`, SECRET)).toBeNull()
  })

  it('rejects a cursor with a flipped character in the body half', () => {
    const cursor = signCursor(payload, SECRET)
    const [body, signature] = cursor.split('.')
    const tamperedBody = body![0] === 'a' ? `b${body!.slice(1)}` : `a${body!.slice(1)}`
    expect(verifyCursor(`${tamperedBody}.${signature}`, SECRET)).toBeNull()
  })

  it('rejects a cursor with no separator', () => {
    expect(verifyCursor('nosuchseparatorhere', SECRET)).toBeNull()
  })

  it('rejects a cursor with more than one separator', () => {
    const cursor = signCursor(payload, SECRET)
    expect(verifyCursor(`${cursor}.extra`, SECRET)).toBeNull()
  })

  it('rejects non-base64url characters', () => {
    expect(verifyCursor('not valid!.also not valid!', SECRET)).toBeNull()
  })

  it('rejects a cursor longer than 512 characters', () => {
    expect(verifyCursor('a'.repeat(513), SECRET)).toBeNull()
  })

  it('rejects a cursor signed with a different secret', () => {
    const cursor = signCursor(payload, SECRET)
    expect(verifyCursor(cursor, OTHER_SECRET)).toBeNull()
  })

  it('rejects a syntactically valid signature over a payload with the wrong shape', () => {
    // Sign a completely different (schema-invalid) payload shape with the
    // SAME secret — the signature is genuine, but decoded JSON must still
    // pass CursorPayloadSchema.
    const badCursor = signCursor({ sort: 'newest', value: 'not-a-date', id: 'not-a-uuid' } as CursorPayload, SECRET)
    expect(verifyCursor(badCursor, SECRET)).toBeNull()
  })

  it('rejects an unknown sort value even with a valid signature', () => {
    const badCursor = signCursor({ ...payload, sort: 'oldest' } as unknown as CursorPayload, SECRET)
    expect(verifyCursor(badCursor, SECRET)).toBeNull()
  })

  it('never throws on garbage input', () => {
    expect(() => verifyCursor('', SECRET)).not.toThrow()
    expect(() => verifyCursor('....', SECRET)).not.toThrow()
    expect(() => verifyCursor('%%%.%%%', SECRET)).not.toThrow()
  })
})
