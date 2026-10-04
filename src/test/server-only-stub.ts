// `server-only` is a build-time marker that Next resolves through its own plugin. It is not
// a real dependency, so Vite cannot resolve it when a test imports a module that carries the
// marker for real. Aliasing it to this empty stub is what lets those modules be unit tested.
//
// Tests that mock the module away entirely do not need this; it is here for tests that
// exercise a `server-only` module's own logic, such as `lib/rooms/members`.
export {};