import { expect, it } from 'vitest'
import { markerAtLine, markerForBar, markerScroll, pagePositions, renderPages } from '../../src/ui/pdf/layout'

it('lays out mixed portrait and landscape sheets in one, two or three columns', () => {
  const heights = [300,200,400,310,100]
  expect(pagePositions(heights,1,10).tops).toEqual([0,310,520,930,1250])
  expect(pagePositions(heights,2,10)).toEqual({tops:[0,0,310,310,720],height:820})
  expect(pagePositions(heights,3,10)).toEqual({tops:[0,0,0,410,410],height:720})
})
it('prioritizes visible pages in a six-canvas budget and preloads neighbors', () => {
  expect(renderPages(new Set([4,3]),10)).toEqual([3,4,2,5])
  expect(renderPages(new Set([1,2,3,4,5,6,7]),10)).toEqual([1,2,3,4,5,6])
  expect(renderPages(new Set([10]),10)).toEqual([10,9])
})
it('follows the latest passed bar at one quarter of viewport height', () => {
  const late = {bar:17,page:2,y:0.5}
  const first = {bar:1,page:1,y:0}
  expect(markerForBar([late,first],16)).toBe(first)
  expect(markerForBar([late,first],18)).toBe(late)
  expect(markerScroll(late,[0,510],[500,500],200,1010)).toBe(710)
  expect(markerScroll(first,[0,510],[500,500],200,1010)).toBe(0)
})

it('round-trips a marker below a shorter neighbor in a two-column row', () => {
  const heights = [200, 500, 400]
  const {tops, height} = pagePositions(heights, 2, 8)
  const marker = markerAtLine(17, 350, tops, heights)!
  expect(marker).toEqual({bar:17, page:2, y:0.7})
  expect(markerScroll(marker, tops, heights, 200, height)).toBe(300)
  expect(markerAtLine(17, 503, tops, heights)).toEqual({bar:17, page:2, y:1})
  expect(markerAtLine(1, 0, [], [])).toBeUndefined()
})
