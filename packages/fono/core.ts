// ─────────────────────────────────────────────────────────────────────────────
//  Fono · core.ts
//  Full Vue-like reactivity + route / layout / middleware definitions
// ─────────────────────────────────────────────────────────────────────────────

import type { Context, MiddlewareHandler, Hono } from 'hono'

// ══════════════════════════════════════════════════════════════════════════════
//  § 1  Dependency tracking
// ══════════════════════════════════════════════════════════════════════════════

export type EffectFn = () => void | (() => void)

const RAW   = Symbol('raw')
const IS_REACTIVE = Symbol('isReactive')
const IS_READONLY = Symbol('isReadonly')
const IS_REF = Symbol('isRef')
const MARK_RAW = Symbol('markRaw')

// Per-target, per-key subscriber sets
const targetMap = new WeakMap<object, Map<PropertyKey, Set<ReactiveEffect>>>()

let activeEffect: ReactiveEffect | null = null
let shouldTrack = true
let trackStack: boolean[] = []

function pauseTracking() { trackStack.push(shouldTrack); shouldTrack = false }
function resetTracking() { shouldTrack = trackStack.pop() ?? true }

function track(target: object, key: PropertyKey) {
  if (!shouldTrack || !activeEffect) return
  let depsMap = targetMap.get(target)
  if (!depsMap) targetMap.set(target, (depsMap = new Map()))
  let dep = depsMap.get(key)
  if (!dep) depsMap.set(key, (dep = new Set()))
  trackEffect(activeEffect, dep)
}

function trackEffect(effect: ReactiveEffect, dep: Set<ReactiveEffect>) {
  if (!dep.has(effect)) {
    dep.add(effect)
    effect.deps.push(dep)
  }
}

function trigger(target: object, key: PropertyKey, newVal?: unknown, oldVal?: unknown) {
  const depsMap = targetMap.get(target)
  if (!depsMap) return
  const effects: ReactiveEffect[] = []
  const computedEffects: ReactiveEffect[] = []

  depsMap.get(key)?.forEach(e => {
    if (e !== activeEffect) {
      e.computed ? computedEffects.push(e) : effects.push(e)
    }
  })
  // Computed run first so dependents see fresh values
  ;[...computedEffects, ...effects].forEach(e => {
    if (e.active) e.scheduler ? e.scheduler() : e.run()
  })
}

// ══════════════════════════════════════════════════════════════════════════════
//  § 2  ReactiveEffect
// ══════════════════════════════════════════════════════════════════════════════

export class ReactiveEffect {
  deps: Set<ReactiveEffect>[] = []
  active = true
  cleanup?: () => void
  computed = false

  constructor(
    public fn: () => any,
    public scheduler?: () => void,
    public scope?: EffectScope,
  ) {
    scope?.effects.push(this)
  }

  run(): any {
    if (!this.active) return this.fn()
    const prevEffect = activeEffect
    const prevShouldTrack = shouldTrack
    shouldTrack = true
    activeEffect = this
    this.cleanup?.()
    this.cleanup = undefined
    this.deps.length = 0
    try {
      const result = this.fn()
      if (typeof result === 'function') this.cleanup = result
      return result
    } finally {
      activeEffect = prevEffect
      shouldTrack = prevShouldTrack
    }
  }

  stop() {
    if (this.active) {
      cleanupEffect(this)
      this.active = false
    }
  }
}

function cleanupEffect(e: ReactiveEffect) {
  e.deps.forEach(dep => dep.delete(e))
  e.deps.length = 0
}

// ══════════════════════════════════════════════════════════════════════════════
//  § 3  EffectScope
// ══════════════════════════════════════════════════════════════════════════════

let activeScope: EffectScope | undefined

export class EffectScope {
  effects: ReactiveEffect[] = []
  cleanups: (() => void)[] = []
  active = true

  run<T>(fn: () => T): T {
    const prev = activeScope
    activeScope = this
    try { return fn() }
    finally { activeScope = prev }
  }

  stop() {
    if (this.active) {
      this.effects.forEach(e => e.stop())
      this.cleanups.forEach(fn => fn())
      this.active = false
    }
  }

  onCleanup(fn: () => void) { this.cleanups.push(fn) }
}

export function effectScope(): EffectScope {
  return new EffectScope()
}

export function getCurrentScope(): EffectScope | undefined {
  return activeScope
}

export function onScopeDispose(fn: () => void) {
  activeScope?.onCleanup(fn)
}

// ══════════════════════════════════════════════════════════════════════════════
//  § 4  effect / watchEffect
// ══════════════════════════════════════════════════════════════════════════════

export function effect(fn: EffectFn): () => void {
  const e = new ReactiveEffect(fn, undefined, activeScope)
  e.run()
  return () => e.stop()
}

export interface WatchEffectOptions {
  flush?: 'sync' | 'post'
  onTrack?: (e: any) => void
  onTrigger?: (e: any) => void
}

export function watchEffect(fn: EffectFn, opts?: WatchEffectOptions): () => void {
  const e = new ReactiveEffect(fn, undefined, activeScope)
  e.run()
  return () => e.stop()
}

// ══════════════════════════════════════════════════════════════════════════════
//  § 5  Ref
// ══════════════════════════════════════════════════════════════════════════════

export interface Ref<T = unknown> {
  value: T
  readonly [IS_REF]: true
}

const refTarget = Symbol('refTarget')

class RefImpl<T> implements Ref<T> {
  readonly [IS_REF] = true as const
  private _value: T
  private _subscribers = new Set<() => void>()

  constructor(value: T, private readonly shallow = false) {
    this._value = shallow ? value : toReactive(value)
  }

  get value(): T {
    track(this as any, refTarget)
    this._subscribers.forEach(fn => { /* for useSyncExternalStore */ })
    return this._value
  }

  set value(next: T) {
    const newVal = this.shallow ? next : toReactive(next)
    if (!hasChanged(newVal, this._value)) return
    this._value = newVal
    trigger(this as any, refTarget, newVal, this._value)
    this._subscribers.forEach(fn => fn())
  }

  /** Subscribe for useSyncExternalStore */
  subscribe(fn: () => void): () => void {
    this._subscribers.add(fn)
    return () => this._subscribers.delete(fn)
  }

  peek(): T { return this._value }
}

export function ref<T>(value: T): Ref<T> {
  return isRef(value) ? value as Ref<T> : new RefImpl(value)
}

export function shallowRef<T>(value: T): Ref<T> {
  return new RefImpl(value, true)
}

export function triggerRef(r: Ref): void {
  if (r instanceof RefImpl) {
    trigger(r as any, refTarget)
    ;(r as any)._subscribers.forEach((fn: () => void) => fn())
  }
}

export function isRef<T = unknown>(r: unknown): r is Ref<T> {
  return !!r && typeof r === 'object' && (r as any)[IS_REF] === true
}

export function unref<T>(r: T | Ref<T>): T {
  return isRef(r) ? r.value : r
}

export function toRef<T extends object, K extends keyof T>(obj: T, key: K): Ref<T[K]> {
  const r = new RefImpl<T[K]>(undefined as T[K], false)
  Object.defineProperty(r, 'value', {
    get() { track(r as any, refTarget); return obj[key] },
    set(v: T[K]) { obj[key] = v; trigger(r as any, refTarget, v, obj[key]) }
  })
  return r
}

export function toRefs<T extends object>(obj: T): { [K in keyof T]: Ref<T[K]> } {
  const result = {} as { [K in keyof T]: Ref<T[K]> }
  for (const key in obj) result[key] = toRef(obj, key)
  return result
}

// ══════════════════════════════════════════════════════════════════════════════
//  § 6  Computed
// ══════════════════════════════════════════════════════════════════════════════

export interface WritableComputedRef<T> extends Ref<T> {
  readonly effect: ReactiveEffect
}

export interface ComputedRef<T> extends WritableComputedRef<T> {
  readonly value: T
}

class ComputedRefImpl<T> implements Ref<T> {
  readonly [IS_REF] = true as const
  readonly effect: ReactiveEffect
  private _value!: T
  private _dirty = true
  private _subscribers = new Set<() => void>()

  constructor(getter: () => T, private setter?: (v: T) => void) {
    this.effect = new ReactiveEffect(getter, () => {
      if (!this._dirty) {
        this._dirty = true
        trigger(this as any, refTarget)
        this._subscribers.forEach(fn => fn())
      }
    }, activeScope)
    this.effect.computed = true
  }

  get value(): T {
    track(this as any, refTarget)
    if (this._dirty) {
      this._dirty = false
      this._value = this.effect.run()
    }
    return this._value
  }

  set value(v: T) {
    this.setter?.(v)
  }

  subscribe(fn: () => void): () => void {
    this._subscribers.add(fn)
    return () => this._subscribers.delete(fn)
  }

  peek(): T { return this._value }
}

export function computed<T>(getter: () => T): ComputedRef<T>
export function computed<T>(opts: { get: () => T; set: (v: T) => void }): WritableComputedRef<T>
export function computed<T>(arg: (() => T) | { get: () => T; set: (v: T) => void }): ComputedRef<T> {
  if (typeof arg === 'function') {
    return new ComputedRefImpl(arg) as ComputedRef<T>
  }
  return new ComputedRefImpl(arg.get, arg.set) as ComputedRef<T>
}

// ══════════════════════════════════════════════════════════════════════════════
//  § 7  Reactive proxy
// ══════════════════════════════════════════════════════════════════════════════

const reactiveMap = new WeakMap<object, object>()
const readonlyMap = new WeakMap<object, object>()
const shallowReactiveMap = new WeakMap<object, object>()

function toReactive<T>(value: T): T {
  return value !== null && typeof value === 'object' ? reactive(value as object) as T : value
}

const arrayInstrumentations: Record<string, Function> = {}
;['includes', 'indexOf', 'lastIndexOf'].forEach(method => {
  arrayInstrumentations[method] = function (this: unknown[], ...args: unknown[]) {
    const arr = toRaw(this) as unknown[]
    for (let i = 0; i < this.length; i++) track(arr, i)
    let res = (arr as any)[method](...args)
    if (res === -1 || res === false) res = (arr as any)[method](...args.map(toRaw))
    return res
  }
})
;['push', 'pop', 'shift', 'unshift', 'splice'].forEach(method => {
  arrayInstrumentations[method] = function (this: unknown[], ...args: unknown[]) {
    pauseTracking()
    const res = (toRaw(this) as any)[method].apply(this, args)
    resetTracking()
    return res
  }
})

function createHandler(shallow = false, readonly = false): ProxyHandler<object> {
  return {
    get(target, key, receiver) {
      if (key === RAW) return target
      if (key === IS_REACTIVE) return !readonly
      if (key === IS_READONLY) return readonly
      if (key === MARK_RAW) return (target as any)[MARK_RAW]

      const isArray = Array.isArray(target)
      if (!readonly && isArray && hasOwn(arrayInstrumentations, key as string)) {
        return Reflect.get(arrayInstrumentations, key, receiver)
      }

      const res = Reflect.get(target, key, receiver)
      if (typeof key === 'symbol' || key === '__proto__') return res

      if (!readonly) track(target, key)

      if (shallow) return res
      if (isRef(res)) return isArray ? res : res.value
      return res !== null && typeof res === 'object' && !res[MARK_RAW]
        ? readonly ? readonlyProxy(res) : reactive(res)
        : res
    },
    set(target, key, value, receiver) {
      if (readonly) {
        console.warn(`[fono] Cannot set "${String(key)}" on readonly object`)
        return true
      }
      const oldVal = (target as any)[key]
      const result = Reflect.set(target, key, value, receiver)
      if (hasChanged(value, oldVal)) trigger(target, key, value, oldVal)
      return result
    },
    deleteProperty(target, key) {
      if (readonly) return true
      const hadKey = hasOwn(target, key as string)
      const result = Reflect.deleteProperty(target, key)
      if (hadKey && result) trigger(target, key)
      return result
    },
    has(target, key) {
      const res = Reflect.has(target, key)
      track(target, key)
      return res
    },
    ownKeys(target) {
      track(target, Array.isArray(target) ? 'length' : '__iterate__')
      return Reflect.ownKeys(target)
    }
  }
}

export function reactive<T extends object>(target: T): T {
  if (isReadonly(target)) return target
  if ((target as any)[MARK_RAW]) return target
  if (reactiveMap.has(target)) return reactiveMap.get(target) as T
  const proxy = new Proxy(target, createHandler()) as T
  reactiveMap.set(target, proxy)
  return proxy
}

export function shallowReactive<T extends object>(target: T): T {
  if (shallowReactiveMap.has(target)) return shallowReactiveMap.get(target) as T
  const proxy = new Proxy(target, createHandler(true)) as T
  shallowReactiveMap.set(target, proxy)
  return proxy
}

function readonlyProxy<T extends object>(target: T): T {
  if (readonlyMap.has(target)) return readonlyMap.get(target) as T
  const proxy = new Proxy(target, createHandler(false, true)) as T
  readonlyMap.set(target, proxy)
  return proxy
}

export function readonly<T extends object>(target: T): Readonly<T> {
  return readonlyProxy(target)
}

export function markRaw<T extends object>(value: T): T {
  ;(value as any)[MARK_RAW] = true
  return value
}

export function toRaw<T>(observed: T): T {
  const raw = (observed as any)?.[RAW]
  return raw ? toRaw(raw) : observed
}

export function isReactive(value: unknown): boolean {
  if (isReadonly(value)) return isReactive((value as any)[RAW])
  return !!(value && (value as any)[IS_REACTIVE])
}

export function isReadonly(value: unknown): boolean {
  return !!(value && (value as any)[IS_READONLY])
}

// ══════════════════════════════════════════════════════════════════════════════
//  § 8  watch
// ══════════════════════════════════════════════════════════════════════════════

export type WatchSource<T = unknown> = Ref<T> | ComputedRef<T> | (() => T)
export type MultiSource = WatchSource[] | readonly WatchSource[]
type MapSources<T, Immediate = false> = {
  [K in keyof T]: T[K] extends WatchSource<infer V>
    ? Immediate extends true ? V | undefined : V
    : T[K] extends object ? T[K] : never
}

export interface WatchOptions<Immediate = boolean> {
  immediate?: Immediate
  deep?: boolean
  once?: boolean
}

type StopHandle = () => void
type CleanupFn = (fn: () => void) => void

function traverse(value: unknown, seen = new Set()): unknown {
  if (!value || typeof value !== 'object' || seen.has(value)) return value
  seen.add(value)
  if (isRef(value)) { traverse(value.value, seen); return value }
  if (Array.isArray(value)) { value.forEach(v => traverse(v, seen)); return value }
  for (const key in value as object) traverse((value as any)[key], seen)
  return value
}

function normalizeSource<T>(src: WatchSource<T> | MultiSource): () => any {
  if (Array.isArray(src)) return () => src.map(s => isRef(s) ? s.value : s())
  if (isRef(src)) return () => src.value
  return src as () => T
}

export function watch<T>(
  source: WatchSource<T>,
  cb: (val: T, old: T | undefined, cleanup: CleanupFn) => void,
  opts?: WatchOptions
): StopHandle
export function watch<T extends MultiSource>(
  source: T,
  cb: (val: MapSources<T>, old: MapSources<T, true>, cleanup: CleanupFn) => void,
  opts?: WatchOptions
): StopHandle
export function watch(source: any, cb: any, opts: WatchOptions = {}): StopHandle {
  const getter = opts.deep
    ? () => traverse(normalizeSource(source)())
    : normalizeSource(source)

  let oldVal: any = undefined
  let cleanupFn: (() => void) | undefined

  const cleanup: CleanupFn = (fn) => { cleanupFn = fn }

  const job = () => {
    if (!effect.active) return
    cleanupFn?.(); cleanupFn = undefined
    const newVal = effect.run()
    if (opts.deep || hasChanged(newVal, oldVal)) {
      cb(newVal, oldVal, cleanup)
      oldVal = newVal
    }
    if (opts.once) effect.stop()
  }

  const effect = new ReactiveEffect(getter, job, activeScope)

  if (opts.immediate) {
    cleanupFn?.(); cleanupFn = undefined
    const val = effect.run()
    cb(val, oldVal, cleanup)
    oldVal = val
  } else {
    oldVal = effect.run()
  }

  return () => effect.stop()
}

// ══════════════════════════════════════════════════════════════════════════════
//  § 9  Component hooks (JSX-aware)
//       Server: returns plain values. Client: patched by client.ts
// ══════════════════════════════════════════════════════════════════════════════

interface FonoHooks {
  useValue<T>(r: Ref<T> | (() => T)): T
  useLocalRef<T>(init: T): Ref<T>
  useLocalReactive<T extends object>(init: T): T
}

// SSR fallbacks — no re-renders needed on server
export const __hooks: FonoHooks = {
  useValue: (r) => isRef(r) ? r.value : r(),
  useLocalRef: (init) => ref(init),
  useLocalReactive: (init) => reactive(init),
}

/**
 * Subscribe to a Ref or computed getter inside a JSX component.
 * On the server, returns the current value (no reactivity needed).
 * On the client, re-renders the component whenever the value changes.
 *
 * @example
 * const count = ref(0)
 * function Counter() {
 *   const n = use(count)
 *   return <button onClick={() => count.value++}>{n}</button>
 * }
 */
export function use<T>(source: Ref<T> | (() => T)): T {
  return __hooks.useValue(source)
}

/**
 * Create a component-local reactive Ref.
 * Unlike module-level `ref()`, this is scoped to the component lifecycle.
 *
 * @example
 * function Input() {
 *   const text = useLocalRef('')
 *   return <input value={use(text)} onInput={e => text.value = e.target.value} />
 * }
 */
export function useLocalRef<T>(init: T): Ref<T> {
  return __hooks.useLocalRef(init)
}

/**
 * Create a component-local reactive object.
 * @example
 * function Form() {
 *   const form = useLocalReactive({ name: '', email: '' })
 *   return <input value={form.name} onInput={e => form.name = e.target.value} />
 * }
 */
export function useLocalReactive<T extends object>(init: T): T {
  return __hooks.useLocalReactive(init)
}

// ══════════════════════════════════════════════════════════════════════════════
//  § 10  Route / App definitions
// ══════════════════════════════════════════════════════════════════════════════

export type LoaderCtx = Context
export type FonoMiddleware = MiddlewareHandler
export type AnyJSX = any

export interface PageDef<TData extends object = {}> {
  readonly __type: 'page'
  path: string
  /** Middleware applied only to this route */
  middleware?: FonoMiddleware[]
  /** Server-side data loader. Return value becomes Page props. */
  loader?: (c: LoaderCtx) => TData | Promise<TData>
  /** Override the group/app layout for this page. Pass `false` to use no layout. */
  layout?: LayoutDef | false
  /** The JSX page component */
  Page: (props: TData & { url: string; params: Record<string, string> }) => AnyJSX
}

export interface GroupDef {
  readonly __type: 'group'
  /** URL prefix — e.g. '/admin' */
  prefix: string
  /** Layout override for all pages in this group */
  layout?: LayoutDef | false
  /** Middleware applied to every route in the group */
  middleware?: FonoMiddleware[]
  /** Pages and nested groups */
  routes: (PageDef<any> | GroupDef | ApiRouteDef)[]
}

export interface LayoutDef {
  readonly __type: 'layout'
  Component: (props: { children: AnyJSX; url: string; params: Record<string, string> }) => AnyJSX
}

export interface ApiRouteDef {
  readonly __type: 'api'
  /** Mount path — e.g. '/api' or '/api/admin' */
  path: string
  /** Register raw Hono routes on the provided sub-app */
  register: (app: Hono, middleware: FonoMiddleware[]) => void
}

export interface MiddlewareDef {
  readonly __type: 'middleware'
  handler: FonoMiddleware
}

export interface AppConfig {
  /** Default layout for all pages */
  layout?: LayoutDef
  /** Global middleware applied before every route */
  middleware?: FonoMiddleware[]
  /** Top-level routes, groups, and API routes */
  routes: (PageDef<any> | GroupDef | ApiRouteDef)[]
  /** 404 page */
  notFound?: () => AnyJSX
}

// ── Builder functions ─────────────────────────────────────────────────────────

export function definePage<TData extends object = {}>(
  def: Omit<PageDef<TData>, '__type'>
): PageDef<TData> {
  return { __type: 'page', ...def }
}

export function defineGroup(
  def: Omit<GroupDef, '__type'>
): GroupDef {
  return { __type: 'group', ...def }
}

export function defineLayout(
  Component: LayoutDef['Component']
): LayoutDef {
  return { __type: 'layout', Component }
}

export function defineMiddleware(handler: FonoMiddleware): MiddlewareDef {
  return { __type: 'middleware', handler }
}

export function defineApiRoute(
  path: string,
  register: ApiRouteDef['register']
): ApiRouteDef {
  return { __type: 'api', path, register }
}

// ── Internal route resolution ─────────────────────────────────────────────────

export interface ResolvedRoute {
  fullPath: string
  page: PageDef<any>
  layout: LayoutDef | false | undefined
  middleware: FonoMiddleware[]
}

export function resolveRoutes(
  routes: (PageDef<any> | GroupDef | ApiRouteDef)[],
  options: {
    prefix?: string
    middleware?: FonoMiddleware[]
    layout?: LayoutDef | false
  } = {}
): { pages: ResolvedRoute[]; apis: ApiRouteDef[] } {
  const pages: ResolvedRoute[] = []
  const apis: ApiRouteDef[] = []

  for (const route of routes) {
    if (route.__type === 'api') {
      apis.push({ ...route, path: (options.prefix ?? '') + route.path })
    } else if (route.__type === 'group') {
      const prefix = (options.prefix ?? '') + route.prefix
      const mw = [...(options.middleware ?? []), ...(route.middleware ?? [])]
      const layout = route.layout !== undefined ? route.layout : options.layout
      const sub = resolveRoutes(route.routes, { prefix, middleware: mw, layout })
      pages.push(...sub.pages)
      apis.push(...sub.apis)
    } else {
      const fullPath = (options.prefix ?? '') + route.path
      const layout = route.layout !== undefined ? route.layout : options.layout
      const middleware = [...(options.middleware ?? []), ...(route.middleware ?? [])]
      pages.push({ fullPath, page: route, layout, middleware })
    }
  }

  return { pages, apis }
}

// ── Shared constants ──────────────────────────────────────────────────────────
export const SPA_HEADER   = 'x-fono-spa'
export const STATE_KEY    = '__FONO_STATE__'
export const PARAMS_KEY   = '__FONO_PARAMS__'

// ── Utilities ─────────────────────────────────────────────────────────────────
function hasChanged(a: unknown, b: unknown): boolean {
  return !Object.is(a, b)
}

function hasOwn(obj: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key)
}
