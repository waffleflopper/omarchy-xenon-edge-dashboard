import assert from 'node:assert/strict'
import { test } from 'node:test'

import { MINUTE, POLICIES, acceptSlot, freshness, isLive, pace, percentLabel, placeApp, projectedLabel, sceneFor } from '../public/domain.mjs'

const NOW = Date.UTC(2026, 9, 12, 12, 0)
const half = (usedPercent) => ({ kind: 'session', label: 'Session', usedPercent, durationMinutes: 300, resetsAt: NOW + 150 * MINUTE })

test('pace classifies the raw projection at the 95 and 105 boundaries', () => {
  assert.equal(pace(half(47.47), NOW).state, 'under') // 94.94
  assert.equal(pace(half(47.475), NOW).state, 'under') // 94.95
  assert.equal(pace(half(47.5), NOW).state, 'at') // 95
  assert.equal(pace(half(52.5), NOW).state, 'at') // 105
  assert.equal(pace(half(52.525), NOW).state, 'over') // 105.05
})

test('projected labels never round across the boundary they report', () => {
  assert.equal(projectedLabel(pace(half(47.47), NOW)), '94.9%')
  assert.equal(projectedLabel(pace(half(47.475), NOW)), '<95%')
  assert.equal(projectedLabel(pace(half(47.5), NOW)), '95.0%')
  assert.equal(projectedLabel(pace(half(52.5), NOW)), '105.0%')
  assert.equal(projectedLabel(pace(half(52.525), NOW)), '>105%')
  assert.equal(projectedLabel(pace(half(20), NOW)), '40%')
  assert.equal(projectedLabel(pace(half(60), NOW)), '120%')
})

test('over pace reports when the window runs out', () => {
  assert.equal(pace(half(60), NOW).runsOutAt, NOW - 150 * MINUTE + 250 * MINUTE)
})

test('percent label keeps a decimal where rounding would misreport it', () => {
  assert.equal(percentLabel(0.4), '0.4%')
  assert.equal(percentLabel(0.04), '<0.1%')
  assert.equal(percentLabel(0), '0%')
  assert.equal(percentLabel(17.4), '17%')
  assert.equal(percentLabel(99.96), '99.9%')
  assert.equal(percentLabel(100), '100%')
})

test('expired, exhausted and early windows are explicit states', () => {
  assert.equal(pace(half(50), NOW + 150 * MINUTE).state, 'expired')
  assert.equal(pace(half(100), NOW).state, 'exhausted')
  const start = NOW + 150 * MINUTE - 300 * MINUTE
  assert.equal(pace(half(1), start + 4 * MINUTE + 59_000).state, 'early')
  assert.equal(pace(half(1), start + 5 * MINUTE).state, 'under')
})

test('freshness tones follow the slot and its policy', () => {
  const p = POLICIES.weather
  assert.deepEqual(freshness({ state: 'pending' }, p, NOW), { tone: 'loading', label: 'loading' })
  assert.equal(freshness({ state: 'ok', value: 1, fetchedAt: NOW - MINUTE }, p, NOW).tone, 'live')
  assert.equal(freshness({ state: 'ok', value: 1, fetchedAt: NOW - 30 * MINUTE }, p, NOW).tone, 'aging')
  assert.equal(freshness({ state: 'ok', value: 1, fetchedAt: NOW - 4 * 60 * MINUTE }, p, NOW).tone, 'expired')
  const stale = { state: 'stale', value: 1, fetchedAt: NOW - 2 * MINUTE, error: { kind: 'timeout', message: 'timed out' }, failedAt: NOW }
  assert.deepEqual(freshness(stale, p, NOW), { tone: 'stale', label: '2 min ago', why: 'timed out' })
  assert.equal(freshness({ state: 'failed', error: { message: 'network unreachable' }, failedAt: NOW }, p, NOW).why, 'network unreachable')
})

test('a restarted server is accepted even though its revisions start over', () => {
  const store = { instance: null, slots: new Map() }
  const ev = (instance, revision) => ({ instance, id: 'theme', revision, slot: { state: 'pending' }, policy: {} })
  assert.equal(acceptSlot(store, ev('a', 40)), true)
  assert.equal(acceptSlot(store, ev('a', 39)), false)
  assert.equal(acceptSlot(store, ev('a', 40)), false)
  assert.equal(acceptSlot(store, ev('b', 1)), true)
  assert.equal(store.slots.get('theme').revision, 1)
})

const SUNSET = NOW - 6 * 60 * MINUTE
const weather = (cloudCover = 10) => ({
  place: { name: 'Fairbanks', lat: 64.84, lon: -147.72 },
  current: { at: NOW - 10 * MINUTE, cloudCover, code: 0, isDay: false },
  days: [{ date: NOW - 18 * 60 * MINUTE, sunrise: SUNSET - 12 * 60 * MINUTE, sunset: SUNSET }],
})
const aurora = (over = {}) => ({
  reading: { probability: 30, observedAt: NOW - 20 * MINUTE, forecastAt: NOW + 30 * MINUTE, lat: 65, lon: -148, ...over },
  current: true,
})

test('aurora shows only when every gate passes', () => {
  const ok = sceneFor(weather(), aurora(), NOW)
  assert.equal(ok.sky, 'night')
  assert.equal(ok.aurora.show, true)
  assert.equal(sceneFor(weather(), aurora(), NOW, false).aurora.show, false, 'weather not current')
  assert.equal(sceneFor(weather(70), aurora(), NOW).aurora.show, false, 'cloudy')
  assert.equal(sceneFor(weather(), aurora({ probability: 9 }), NOW).aurora.show, false, 'low probability')
  assert.equal(sceneFor(weather(), aurora({ lat: 40 }), NOW).aurora.show, false, 'other location')
  assert.equal(sceneFor(weather(), { ...aurora(), current: false }, NOW).aurora.show, false, 'expired slot')
  assert.equal(sceneFor(weather(), null, NOW).aurora.show, false, 'no reading')
})

test('aurora needs live slots and a recent weather observation', () => {
  const p = POLICIES.weather
  const aging = freshness({ state: 'ok', value: 1, fetchedAt: NOW - 30 * MINUTE }, p, NOW)
  assert.equal(aging.tone, 'aging')
  assert.equal(isLive(aging), false)
  assert.equal(sceneFor(weather(), aurora(), NOW, isLive(aging)).aurora.show, false)
  const oldObs = { ...weather(), current: { ...weather().current, at: NOW - 61 * MINUTE } }
  assert.equal(sceneFor(oldObs, aurora(), NOW).aurora.gates.weather, false)
})

test('an old OVATION run is not fresh even if its forecast time looks recent', () => {
  const old = sceneFor(weather(), aurora({ observedAt: NOW - 91 * MINUTE, forecastAt: NOW }), NOW)
  assert.equal(old.aurora.gates.fresh, false)
  assert.equal(old.aurora.show, false)
})

test('aurora is never drawn in daylight', () => {
  const noon = { ...weather(), days: [{ date: NOW - 12 * 60 * MINUTE, sunrise: NOW - 4 * 60 * MINUTE, sunset: NOW + 6 * 60 * MINUTE }] }
  const s = sceneFor(noon, aurora(), NOW)
  assert.equal(s.sky, 'day')
  assert.equal(s.aurora.gates.dark, false)
  assert.equal(s.aurora.show, false)
})

const H = { label: 'Helium', desktopId: 'helium.desktop' }
const T = { label: 'Terminal', desktopId: 'foot.desktop' }
const D = { label: 'Discord', desktopId: 'Discord.desktop' }

test('choosing an app already in another slot swaps instead of dropping a launcher', () => {
  assert.deepEqual(placeApp([H, T, D], 0, D), [D, T, H])
  assert.deepEqual(placeApp([H, T, D], 3, H), [T, D, H])
  assert.deepEqual(placeApp([H, T], 1, D), [H, D])
  assert.deepEqual(placeApp([H, T], 2, D), [H, T, D])
  assert.deepEqual(placeApp([H, T], 1, T), [H, T])
})
