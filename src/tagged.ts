// The `./tagged` entry point. Its surface arrives with the tagged-value
// representation in a later bead; the module exists now because
// `package.json`'s `exports` and `tsup.config.ts`'s entry list both name it,
// and a build entry pointing at a missing file fails the gate.
export {};
