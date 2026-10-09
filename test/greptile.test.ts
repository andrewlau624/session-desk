import { describe, expect, it } from 'vitest'
import { greptileStatus, type PrComment } from '../src/main/greptile'

const HEAD = 'c'.repeat(40)
const OLD = 'a'.repeat(40)
const MID = 'b'.repeat(40)
const COMMITS = [OLD, MID, HEAD]

// Modelled on Greptile's real summary comment.
const summary = (reviewed: string, updatedAt = '2026-10-08T02:06:00Z', score = 5): PrComment => ({
  author: 'greptile-apps',
  updatedAt,
  body: `<!-- greptile_summary -->\n<h3>Greptile Summary</h3>\n<h2>Confidence Score: ${score}/5</h2>\n...\n<sub>Last reviewed commit: ["fix the acs"](https://github.com/o/r/commit/${reviewed}) · [Reviews (3)](https://app.greptile.com)</sub>`
})
const notice: PrComment = {
  author: 'greptile-apps',
  updatedAt: '2026-10-08T02:09:00Z',
  body: '<!-- greptile-status -->\nAutomatic reviews are disabled for this repository.'
}
const ask = (updatedAt: string): PrComment => ({ author: 'someone', updatedAt, body: '@greptileai review' })

describe('greptileStatus', () => {
  it('is current when the last reviewed commit is the head', () => {
    expect(greptileStatus([summary(HEAD)], HEAD, COMMITS)).toEqual({ state: 'current', confidence: 5 })
  })

  it('counts commits landed since the review', () => {
    expect(greptileStatus([summary(OLD)], HEAD, COMMITS)).toEqual({ state: 'behind', behindBy: 2, confidence: 5 })
  })

  it('reports an older version when the reviewed commit was rebased away', () => {
    expect(greptileStatus([summary('d'.repeat(40))], HEAD, COMMITS)).toEqual({ state: 'behind', behindBy: null, confidence: 5 })
  })

  it('a newer @greptileai comment means a review is requested', () => {
    expect(greptileStatus([summary(OLD), ask('2026-10-08T03:00:00Z')], HEAD, COMMITS)).toEqual({
      state: 'requested',
      at: '2026-10-08T03:00:00Z'
    })
    // An older request was answered by the summary.
    expect(greptileStatus([ask('2026-10-08T01:00:00Z'), summary(HEAD)], HEAD, COMMITS).state).toBe('current')
  })

  it('a status notice alone is not a review, nor is a summary by someone else', () => {
    // The notice shows Greptile is on the repo, just not that it reviewed.
    expect(greptileStatus([notice], HEAD, COMMITS)).toEqual({ state: 'none' })
    expect(greptileStatus([notice, { ...summary(HEAD), author: 'someone' }], HEAD, COMMITS)).toEqual({ state: 'none' })
  })

  it('is absent on repos where Greptile has never posted', () => {
    expect(greptileStatus([], HEAD, COMMITS)).toEqual({ state: 'absent' })
    expect(greptileStatus([{ author: 'someone', body: 'lgtm', updatedAt: 'x' }], HEAD, COMMITS)).toEqual({ state: 'absent' })
  })

  it('the newest summary wins; it is edited in place but may be re-posted', () => {
    const comments = [summary(OLD, '2026-10-01T00:00:00Z', 3), summary(HEAD, '2026-10-08T00:00:00Z', 4)]
    expect(greptileStatus(comments, HEAD, COMMITS)).toEqual({ state: 'current', confidence: 4 })
  })

  it('an unreadable summary counts as behind rather than trusted', () => {
    const broken: PrComment = { author: 'greptile-apps', updatedAt: 'x', body: '<!-- greptile_summary -->\nConfidence Score: 2/5' }
    expect(greptileStatus([broken], HEAD, COMMITS)).toEqual({ state: 'behind', behindBy: null, confidence: 2 })
  })
})
