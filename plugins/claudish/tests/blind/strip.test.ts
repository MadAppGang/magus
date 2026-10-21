// R12 only. Exact examples and independent invariants from spec.md / layout-contract.md.
// No implementation reads; wrapTabs is exercised solely through its public return value.
import { expect } from 'claude-code/testing'
import { test } from '../kit'
import { SHOW_CELLS, TAB_FLOOR, wrapTabs, type StripTab } from '../../hooks/status/layout'

const FOUR = ['gpt-6.1-sol', 'kimi-k3', 'grok-4.6', 'glm-5.3'] as const
const EIGHT = [...FOUR, 'gemini-3.8-pro', 'qwen3.8-max', 'deepseek-v4', 'minimax-m3']
const points = (s: string) => Array.from(s).length
const floor = (s: string) => Math.min(6, points(s))
const tabsOf = (labels: readonly string[]) => labels.map((label, index) => ({ id: `tab-${index}`, label }))
const at = (index: number, label: string): StripTab => ({ index, label })
const breaks = (rows: StripTab[][]) => rows.map(row => row.map(tab => tab.index))
const drawn = (rows: StripTab[][]) => rows.map(row => row.map(tab => ` ● ${tab.label} `).join('│'))
const rowCost = (row: StripTab[]) => row.reduce((sum, tab) => sum + points(tab.label) + 4, 0) + Math.max(0, row.length - 1)

const MIXED = ['x', 'abcdef', 'abcdefg', 'delegation-review-alpha', '😀😃😄😁😆😅😂🤣😊😇', 'yz', 'abcdefghijk', 'éééé']
function mixed(count: number): string[] {
  return Array.from({ length: count }, (_, i) => MIXED[(i + count) % MIXED.length]!)
}

/** Minimum contiguous floor partition, solved backwards instead of reproducing the label cutter. */
function minimumFloorRows(labels: readonly string[], width: number): number {
  if (labels.length === 0) return 1
  const tail = new Array<number>(labels.length + 1).fill(Infinity)
  tail[labels.length] = 0
  for (let start = labels.length - 1; start >= 0; start--) {
    let used = 0
    for (let end = start; end < labels.length; end++) {
      used += floor(labels[end]!) + 4 + (end === start ? 0 : 1)
      // A later row always admits one tab, even below the floor.
      if (used <= width || end === start) tail[start] = Math.min(tail[start]!, 1 + tail[end + 1]!)
      if (used > width) break
    }
  }
  const room = Math.max(0, width - 8)
  if (floor(labels[0]!) + 4 > room) return 1 + tail[0]!
  let best = Infinity
  let used = 0
  for (let end = 0; end < labels.length; end++) {
    used += floor(labels[end]!) + 4 + (end === 0 ? 0 : 1)
    if (used > room) break
    best = Math.min(best, 1 + tail[end + 1]!)
  }
  return best
}

/** Only R12.3's cap placing: computes indices, never the final drawn labels or active protection. */
function capBreaks(labels: readonly string[], width: number, cap: number): number[][] {
  const rows: number[][] = [[]]
  let used = 0
  for (let index = 0; index < labels.length; index++) {
    let length = Math.min(points(labels[index]!), cap)
    if (rows.length === 1 && rows[0]!.length === 0) {
      const firstRoom = Math.max(0, width - 8)
      if (floor(labels[index]!) + 4 > firstRoom) rows.push([])
      else length = Math.min(length, firstRoom - 4)
    }
    const room = rows.length === 1 ? Math.max(0, width - 8) : width
    let row = rows[rows.length - 1]!
    if (row.length > 0 && used + 1 + length + 4 > room) {
      row = []
      rows.push(row)
      used = 0
    }
    used += length + 4 + (row.length > 0 ? 1 : 0)
    row.push(index)
  }
  return rows
}

// TEST-1 / REQ-1
// Literal expectations deliberately do not use these exports as the oracle for the other tests.
test('R12 TEST-1: the readable floor is 6 cells and first-row Hide costs 8', () => {
  expect({ floor: TAB_FLOOR, hide: SHOW_CELLS }).toEqual({ floor: 6, hide: 8 })
})

// TEST-2 / REQ-5, REQ-6, REQ-14
test('R12.8 TEST-2: width 60 keeps all four labels whole for every active choice', () => {
  const tabs = tabsOf(FOUR)
  for (const active of [null, ...tabs.map(tab => tab.id)]) {
    const rows = wrapTabs(tabs, active, 60)
    expect(rows).toEqual([[at(0, FOUR[0]), at(1, FOUR[1]), at(2, FOUR[2]), at(3, FOUR[3])]])
    expect(drawn(rows)).toEqual([' ● gpt-6.1-sol │ ● kimi-k3 │ ● grok-4.6 │ ● glm-5.3 '])
    expect(rowCost(rows[0]!)).toBe(52)
  }
})

// TEST-3 / REQ-6, REQ-14
test('R12.8 TEST-3: width 56 cuts grok, kimi, grok, glm while protecting the active first tab', () => {
  const rows = wrapTabs(tabsOf(FOUR), 'tab-0', 56)

  expect(rows).toEqual([[at(0, 'gpt-6.1-sol'), at(1, 'kimi-…'), at(2, 'grok-…'), at(3, 'glm-5…')]])
  expect(drawn(rows)).toEqual([' ● gpt-6.1-sol │ ● kimi-… │ ● grok-… │ ● glm-5… '])
  expect(rowCost(rows[0]!)).toBe(48)
})

// TEST-4 / REQ-3, REQ-6, REQ-14
test('R12.8 TEST-4: width 51 cuts even the active label last, keeping the six-cell floor', () => {
  const rows = wrapTabs(tabsOf(FOUR), 'tab-0', 51)

  expect(rows).toEqual([[at(0, 'gpt-6…'), at(1, 'kimi-…'), at(2, 'grok-…'), at(3, 'glm-5…')]])
  expect(drawn(rows)).toEqual([' ● gpt-6… │ ● kimi-… │ ● grok-… │ ● glm-5… '])
  expect(rowCost(rows[0]!)).toBe(43)
})

// TEST-5 / REQ-3, REQ-5, REQ-14
test('R12.8 TEST-5: width 50 wraps to three whole tabs then one whole tab, for any active choice', () => {
  const tabs = tabsOf(FOUR)
  for (const active of [null, ...tabs.map(tab => tab.id)]) {
    const rows = wrapTabs(tabs, active, 50)
    expect(rows).toEqual([[at(0, FOUR[0]), at(1, FOUR[1]), at(2, FOUR[2])], [at(3, FOUR[3])]])
    expect(drawn(rows)).toEqual([' ● gpt-6.1-sol │ ● kimi-k3 │ ● grok-4.6 ', ' ● glm-5.3 '])
    expect(rowCost(rows[0]!)).toBe(40)
  }
})

// TEST-6 / REQ-5, REQ-6, REQ-14
test('R12.8 TEST-6: eight tabs at width 40 use the cap-8 breaks and independently cut each row', () => {
  const rows = wrapTabs(tabsOf(EIGHT), 'tab-0', 40)

  expect(rows).toEqual([
    [at(0, 'gpt-6.1-sol'), at(1, 'kimi-k3')],
    [at(2, 'grok-4.6'), at(3, 'glm-5.3'), at(4, 'gemini-3.8…')],
    [at(5, 'qwen3.8…'), at(6, 'deepseek…'), at(7, 'minimax-…')],
  ])
  expect(drawn(rows)).toEqual([
    ' ● gpt-6.1-sol │ ● kimi-k3 ',
    ' ● grok-4.6 │ ● glm-5.3 │ ● gemini-3.8… ',
    ' ● qwen3.8… │ ● deepseek… │ ● minimax-… ',
  ])
  expect(rows.map(rowCost)).toEqual([27, 40, 40])
})

// TEST-7 / REQ-3, REQ-4, REQ-14
test('R12.8 TEST-7: width 15 leaves row 1 empty and keeps the three singleton labels whole', () => {
  const rows = wrapTabs(tabsOf(FOUR.slice(0, 3)), 'tab-0', 15)

  expect(rows).toEqual([[], [at(0, 'gpt-6.1-sol')], [at(1, 'kimi-k3')], [at(2, 'grok-4.6')]])
  expect(drawn(rows)).toEqual(['', ' ● gpt-6.1-sol ', ' ● kimi-k3 ', ' ● grok-4.6 '])
})

// TEST-8 / REQ-2, REQ-3, REQ-14
test('R12.8 TEST-8: width 8 keeps Hide alone and cuts only later singleton labels below their floor', () => {
  const rows = wrapTabs(tabsOf(FOUR.slice(0, 3)), 'tab-0', 8)

  expect(rows).toEqual([[], [at(0, 'gpt…')], [at(1, 'kim…')], [at(2, 'gro…')]])
  expect(drawn(rows)).toEqual(['', ' ● gpt… ', ' ● kim… ', ' ● gro… '])
})

// TEST-9 / REQ-4, REQ-5, REQ-6, REQ-14
test('R12.8 TEST-9: width 30 keeps the long first tab on row 1 instead of putting only Hide there', () => {
  const rows = wrapTabs(tabsOf(['delegation-review-alpha', 'kimi-k3', 'grok-4.6']), 'tab-0', 30)

  expect(rows).toEqual([[at(0, 'delegation-review…')], [at(1, 'kimi-k3'), at(2, 'grok-4.6')]])
  expect(drawn(rows)).toEqual([' ● delegation-review… ', ' ● kimi-k3 │ ● grok-4.6 '])
  expect(rows.map(rowCost)).toEqual([22, 24])
})

// TEST-10 / REQ-4, REQ-5, REQ-14
test('R12.8 TEST-10: width 23 clamps the first long label before placing x on row 2', () => {
  const rows = wrapTabs(tabsOf(['abcdefghijklmnopqrst', 'x']), 'tab-0', 23)

  expect(rows).toEqual([[at(0, 'abcdefghij…')], [at(1, 'x')]])
  expect(drawn(rows)).toEqual([' ● abcdefghij… ', ' ● x '])
})

// TEST-11 / REQ-5, REQ-14
test('R12.8 TEST-11: no tabs always returns one empty tab row, even below Hide width', () => {
  for (const width of [0, 1, 4, 5, 7, 8, 15, 40, 80, 120]) expect(wrapTabs([], null, width)).toEqual([[]])
})

// TEST-12 / REQ-1, REQ-2, REQ-3, REQ-4, REQ-5, REQ-6
test('R12.1–R12.3 TEST-12: widths 0–120 and counts 0–16 preserve order, row bounds, readable floors and code-point prefixes', () => {
  for (let count = 0; count <= 16; count++) {
    const labels = mixed(count)
    const tabs = tabsOf(labels)
    for (let width = 0; width <= 120; width++) {
      const context = `count=${count}, width=${width}`
      const rows = wrapTabs(tabs, tabs[count - 1]?.id ?? null, width)
      expect(rows.length, context).toBeGreaterThanOrEqual(1)
      expect(rows.flat().map(tab => tab.index), context).toEqual(tabs.map((_, index) => index))
      expect(rows[0]!.length === 0, context).toBe(count === 0 || Math.max(0, width - 8) < floor(labels[0]!) + 4)
      for (let r = 0; r < rows.length; r++) {
        const row = rows[r]!
        const room = r === 0 ? Math.max(0, width - 8) : width
        if (r > 0) expect(row.length, context).toBeGreaterThan(0)
        const tiny = r > 0 && room < 5
        if (tiny) {
          expect(row.length, context).toBe(1)
          expect(rowCost(row), context).toBe(5)
        } else expect(rowCost(row), `${context}, row=${r}`).toBeLessThanOrEqual(room)
        const wholeCost = row.reduce((sum, tab) => sum + points(labels[tab.index]!) + 4, 0) + Math.max(0, row.length - 1)
        if (wholeCost <= room) expect(row.map(tab => tab.label), context).toEqual(row.map(tab => labels[tab.index]!))
        if (wholeCost > room && !tiny) expect(rowCost(row), 'cutting one cell at a time uses all available room').toBe(room)
        const activeOnRow = row.find(tab => tab.index === count - 1)
        const belowFloor = row.some(tab => points(tab.label) < floor(labels[tab.index]!))
        if (!belowFloor && activeOnRow && points(activeOnRow.label) < points(labels[activeOnRow.index]!)) {
          for (const other of row.filter(tab => tab !== activeOnRow)) expect(points(other.label), 'active cuts only after all others reach floor').toBe(floor(labels[other.index]!))
        }
        const inactive = row.filter(tab => tab.index !== count - 1)
        for (let a = 0; a < inactive.length; a++) for (let b = a + 1; b < inactive.length; b++) {
          const first = inactive[a]!, second = inactive[b]!
          if (points(labels[first.index]!) === points(labels[second.index]!)) {
            expect(points(first.label), 'the first equal-length label loses the tie').toBeLessThanOrEqual(points(second.label))
            expect(points(second.label) - points(first.label), 'equal-length non-active labels differ by at most one cut').toBeLessThanOrEqual(1)
          }
        }
        for (const tab of row) {
          const original = labels[tab.index]!
          const size = points(tab.label)
          const exception = r > 0 && width < floor(original) + 4
          expect(size, context).toBeGreaterThanOrEqual(exception ? 1 : floor(original))
          expect(size, context).toBeLessThanOrEqual(points(original))
          if (exception) {
            expect(row.length, context).toBe(1)
            expect(size, context).toBe(Math.max(1, width - 4))
          }
          expect(tab.label, context).toBe(size === points(original) ? original : Array.from(original).slice(0, size - 1).join('') + '…')
          if (!exception && points(original) <= 6) expect(tab.label, context).toBe(original)
        }
      }
    }
  }
})

// TEST-13 / REQ-5
test('R12.3 TEST-13: a width/count sweep uses the minimum floor partition and the largest-cap breaks, not floor breaks', () => {
  for (let count = 0; count <= 12; count++) {
    const labels = mixed(count)
    const tabs = tabsOf(labels)
    for (let width = 0; width <= 100; width++) {
      const context = `count=${count}, width=${width}`
      const minimum = minimumFloorRows(labels, width)
      let expected: number[][] | undefined
      for (let cap = Math.max(6, ...labels.map(points)); cap >= 6; cap--) {
        const candidate = capBreaks(labels, width, cap)
        if (candidate.length === minimum) { expected = candidate; break }
      }
      expect(expected, `${context}: a qualifying cap exists`).toBeDefined()
      const actual = wrapTabs(tabs, null, width)
      expect(actual.length, context).toBe(minimum)
      expect(breaks(actual), context).toEqual(expected!)
    }
  }
})

// TEST-14 / REQ-13
test('R12.7 TEST-14: repeated frozen inputs are deterministic and every active choice preserves the same breaks', () => {
  for (let count = 0; count <= 12; count++) {
    const tabs = Object.freeze(tabsOf(mixed(count)).map(tab => Object.freeze(tab)))
    const before = JSON.stringify(tabs)
    for (let width = 0; width <= 90; width++) {
      const baseline = breaks(wrapTabs(tabs, null, width))
      for (const active of [null, ...tabs.map(tab => tab.id)]) {
        const context = `count=${count}, width=${width}, active=${active}`
        const first = wrapTabs(tabs, active, width)
        expect(wrapTabs(tabs, active, width), context).toEqual(first)
        expect(breaks(first), context).toEqual(baseline)
      }
    }
    expect(JSON.stringify(tabs), 'the readonly inputs remain unchanged').toBe(before)
  }
})

// TEST-15 / REQ-6, REQ-13
test('R12.4 TEST-15: ties cut the first non-active label, active identity protects duplicates, and cuts stay row-local', () => {
  const tied = tabsOf(['abcdefghi', 'jklmnopqr'])
  expect(wrapTabs(tied, null, 34)).toEqual([[at(0, 'abcdefg…'), at(1, 'jklmnopqr')]])
  expect(wrapTabs(tied, 'tab-0', 34)).toEqual([[at(0, 'abcdefghi'), at(1, 'jklmnop…')]])
  expect(wrapTabs(tied, 'tab-1', 34)).toEqual([[at(0, 'abcdefg…'), at(1, 'jklmnopqr')]])
  expect(wrapTabs(tied, null, 33)).toEqual([[at(0, 'abcdefg…'), at(1, 'jklmnop…')]])

  const duplicates = tabsOf(['abcdefghij', 'abcdefghij'])
  expect(wrapTabs(duplicates, 'tab-1', 35)).toEqual([[at(0, 'abcdefg…'), at(1, 'abcdefghij')]])
  expect(wrapTabs(duplicates, 'tab-0', 35)).toEqual([[at(0, 'abcdefghij'), at(1, 'abcdefg…')]])
  expect(wrapTabs(duplicates, null, 35)).toEqual([[at(0, 'abcdefgh…'), at(1, 'abcdefgh…')]])

  const normal = wrapTabs(tabsOf(EIGHT), 'tab-0', 40)
  const laterActive = wrapTabs(tabsOf(EIGHT), 'tab-4', 40)
  expect(breaks(laterActive)).toEqual(breaks(normal))
  expect(laterActive[0]).toEqual(normal[0])
  expect(laterActive[2]).toEqual(normal[2])
  expect(laterActive[1]).toEqual([at(2, 'grok-…'), at(3, 'glm-5…'), at(4, 'gemini-3.8-pro')])
})

// TEST-16 / REQ-1, REQ-2, REQ-3
test('R12 Terms/R12.2 TEST-16: cuts count code points, preserving astral characters and counting combining marks separately', () => {
  const emoji = '😀😃😄😁😆😅😂🤣😊😇'
  expect(wrapTabs(tabsOf([emoji]), 'tab-0', 18)).toEqual([[at(0, '😀😃😄😁😆…')]])
  expect(wrapTabs(tabsOf([emoji]), null, 8)).toEqual([[], [at(0, '😀😃😄…')]])
  expect(wrapTabs(tabsOf(['😀😃😄😁😆😅']), null, 18)).toEqual([[at(0, '😀😃😄😁😆😅')]])
  expect(wrapTabs(tabsOf(['漢字甲乙丙丁戊己庚辛']), null, 18)).toEqual([[at(0, '漢字甲乙丙…')]])

  const combining = 'é'.repeat(6)
  expect(wrapTabs(tabsOf([combining]), null, 18)).toEqual([[at(0, 'éée…')]])
  expect(wrapTabs(tabsOf([combining]), null, 9)).toEqual([[], [at(0, 'éé…')]])
  for (const width of [0, 1, 2, 3, 4, 5]) {
    expect(wrapTabs(tabsOf([emoji]), null, width)).toEqual([[], [at(0, '…')]])
  }
})

// TEST-17 / REQ-3, REQ-4
test('R12.2 TEST-17: the first tab enters row 1 exactly at floor + 12 columns, including labels shorter than six', () => {
  for (const label of ['x', 'ab', 'abc', 'abcd', 'abcde', 'abcdef', 'abcdefg', 'abcdefghijklmnopqrst']) {
    const threshold = floor(label) + 12
    const tabs = tabsOf([label])
    const below = wrapTabs(tabs, 'tab-0', threshold - 1)
    const exact = wrapTabs(tabs, 'tab-0', threshold)
    const wider = wrapTabs(tabs, 'tab-0', points(label) + 12)
    expect(breaks(below), label).toEqual([[], [0]])
    expect(breaks(exact), label).toEqual([[0]])
    expect(points(exact[0]![0]!.label), label).toBe(floor(label))
    if (points(label) <= 6) expect(exact[0]![0]!.label, label).toBe(label)
    expect(wider, label).toEqual([[at(0, label)]])
  }
})
