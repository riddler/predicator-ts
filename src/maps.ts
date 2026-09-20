/**
 * Three small primitives that several modules need: the test for a plain map,
 * the write of one key into a map being built, and the read of one own data
 * property.
 *
 * This module is internal: neither entry point re-exports it. The value
 * boundary, the context's write path, the tagged codec, the JSON functions and
 * the machine's object opcode import what they use of it from here rather than
 * each keeping a copy, so that the package answers one way to what a plain map
 * is, how a key is written into one, and how a property is read without running
 * host code.
 */

import type { Value } from "./values.js";

/**
 * Whether an object carries one of the two prototypes a plain map may have:
 * `Object.prototype`, which every map this package builds carries, or none at
 * all, which a host may build.
 *
 * The prototype is the whole test, and it is what excludes the domain members
 * this package models as classes: each carries its own prototype, so none of
 * them needs a clause of its own here.
 */
export function hasPlainPrototype(value: object): boolean {
  const proto = Object.getPrototypeOf(value) as unknown;
  return proto === null || proto === Object.prototype;
}

/**
 * Answers whether a value is a plain map rather than a list, a value class, a
 * host type or a class instance this package did not define.
 *
 * The machine's own `isPlainMap` in the evaluator is a different, wider test -
 * it reads any object that is not a list and not a domain class as a map - and
 * is not this one.
 */
export function isPlainMap(value: unknown): value is { [key: string]: Value } {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  return hasPlainPrototype(value);
}

/**
 * Writes one key of a map being built.
 *
 * It goes through `defineProperty` because the key is whatever the host, the
 * value being projected, a path segment, the decoded text or the program said,
 * and a plain assignment of the key `__proto__` would set the object's
 * prototype instead of adding a member - a map read back as something other
 * than what was written.
 */
export function setKey<T>(target: { [key: string]: T }, key: string, value: T): void {
  Object.defineProperty(target, key, {
    value,
    writable: true,
    enumerable: true,
    configurable: true,
  });
}

/** What `ownData` answers for a property that is absent or is an accessor. */
const NOT_DATA = Symbol("not a data property");

/**
 * Reads an object's own data property through its descriptor, so that no
 * getter runs; an absent property or an accessor answers `NOT_DATA`.
 *
 * The value classes' `instanceof` test reads the key and the fields it asks
 * for this way, and the two writers that spell a float read its field the same
 * way, so that what they write is the property the test read rather than the
 * answer of a method on the object.
 */
export function ownData(candidate: object, key: PropertyKey): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(candidate, key);
  return descriptor !== undefined && "value" in descriptor ? descriptor.value : NOT_DATA;
}
