//! TJM engine bridge. `core` is platform-neutral (tested natively); `wasm` exposes it to JS.
#![deny(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

pub mod core;
pub mod psd_post;
pub mod schema;

#[cfg(target_arch = "wasm32")]
mod gpu;

#[cfg(target_arch = "wasm32")]
mod wasm;

#[cfg(test)]
mod tests;
